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
  // 退避为境外链路校准：实测国内连发十几个请求后，Mapbox 连接会
  // 成片断掉（HTTP 000），且抖动窗口有数秒——0.4/0.8s 的退避会让
  // 三次尝试全打在同一段抖动里，最终以「失败」示人。
  // 0.8/1.6/3.2s 共约 5.6s 的退避能跨过多数抖动窗口。
  const retries = opts.retries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 800

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
