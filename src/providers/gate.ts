import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

/**
 * ArrivalRange 一次只能处理一个起点一个档位，请求数是「点数 × 档位数」。
 * 3 点 × 4 档就是 12 个并发，足以触发高德的 QPS 限制。
 * 不加闸门会随机丢圈——这是正确性问题，不是性能优化。
 */
export const MAX_CONCURRENCY = 4

type GateOptions = { retries?: number; baseDelayMs?: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function withGate(inner: IsochroneProvider, opts: GateOptions = {}): IsochroneProvider {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 400

  let active = 0
  const waiting: Array<() => void> = []

  async function acquire(): Promise<void> {
    if (active < MAX_CONCURRENCY) {
      active++
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
    active++
  }

  function release(): void {
    active--
    const next = waiting.shift()
    if (next) next()
  }

  async function attempt(req: IsochroneRequest): Promise<PolyFeature | null> {
    let lastError: unknown
    for (let i = 0; i <= retries; i++) {
      try {
        return await inner.fetch(req)
      } catch (err) {
        lastError = err
        if (i < retries) await sleep(baseDelayMs * 2 ** i)
      }
    }
    throw lastError
  }

  return {
    id: inner.id,
    supportedModes: inner.supportedModes,
    async fetch(req) {
      await acquire()
      try {
        return await attempt(req)
      } finally {
        release()
      }
    },
  }
}
