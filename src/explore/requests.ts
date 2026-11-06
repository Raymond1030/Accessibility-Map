import { fetchCommuteRoute, type RouteRequest } from '../commute/amap'

export const abortError = () => new DOMException('查询已取消', 'AbortError')
export function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw abortError() }

/** One queue for new POI and routing requests. Timeout starts after acquiring a slot. */
export class RequestPool {
  private active = 0
  private waiting: Array<() => void> = []
  private cache = new Map<string, { expires: number; value: unknown }>()
  private flying = new Map<string, Promise<unknown>>()
  private nextStart = 0
  constructor(private concurrency = 2, private ttl = 600_000, private timeout = 15_000, private interval = 0) {}
  private async pace() {
    const start = Math.max(Date.now(), this.nextStart)
    this.nextStart = start + this.interval
    if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()))
  }
  async run<T>(key: string, work: (requestSignal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    checkSignal(signal)
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) return cached.value as T
    const existing = this.flying.get(key)
    if (existing) {
      try { const value = await existing as T; checkSignal(signal); return value }
      catch (error) {
        checkSignal(signal)
        if (error instanceof DOMException && error.name === 'AbortError') return this.run(key, work, signal)
        throw error
      }
    }
    const promise = (async () => {
      await new Promise<void>(resolve => {
        const start = () => { this.active++; resolve() }
        if (this.active < this.concurrency) start(); else this.waiting.push(start)
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const operation = new AbortController()
      try {
        // A queued task is no longer useful after its input changes.
        checkSignal(signal)
        await this.pace()
        checkSignal(signal)
        const attempt = async () => {
          for (let retry = 0; ; retry++) {
            checkSignal(operation.signal)
            checkSignal(signal)
            try { return await work(operation.signal) }
            catch (error) {
              if (retry >= 2 || !/QPS|TOO_FREQUENT|限流/i.test(String(error))) throw error
              await new Promise(resolve => setTimeout(resolve, 1200 * (retry + 1)))
              checkSignal(signal)
              await this.pace()
            }
          }
        }
        const result = await Promise.race([
          attempt(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { operation.abort(); reject(new Error('查询超时，请重试。')) }, this.timeout) }),
        ])
        this.cache.set(key, { value: result, expires: Date.now() + this.ttl })
        if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value!)
        return result
      } finally {
        operation.abort()
        clearTimeout(timer)
        this.active--
        this.waiting.shift()?.()
      }
    })()
    this.flying.set(key, promise)
    try { const value = await promise; checkSignal(signal); return value }
    finally { this.flying.delete(key) }
  }
}
export const requests = new RequestPool(2, 600_000, 15_000, 1100)
export const routeFingerprint = (r: RouteRequest) => JSON.stringify(['route', r.origin, r.destination, r.city.trim(), r.destinationCity.trim(), r.mode])
export const queryRoute = (r: RouteRequest, signal?: AbortSignal) => requests.run(routeFingerprint(r), () => fetchCommuteRoute(r), signal)
