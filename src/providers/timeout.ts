import type { IsochroneProvider } from './cache'
import type { PolyFeature } from '../geometry/ops'

export class ProviderTimeoutError extends Error {
  constructor(minutes: number, ms: number) {
    super(`等时圈请求超时（${minutes} 分钟档，等待 ${ms}ms 无响应）`)
    this.name = 'ProviderTimeoutError'
  }
}

/** 高德正常响应在 1~3 秒，10 秒仍无回调基本可判定为静默失败 */
export const DEFAULT_TIMEOUT_MS = 10_000

/**
 * 给 provider 加超时。
 *
 * 这不是防御性编程，是修一个实际发生过的故障：高德在域名未授权（INVALID_USER_DOMAIN）
 * 等情况下会**静默失败——回调根本不触发**。由于 provider 用 Promise 包装回调，
 * 回调不来就意味着 Promise 永远 pending：格子永久停在「计算中」，既不报错也无法重试，
 * 而且并发闸门的名额永远不释放，几个这样的请求就能把闸门彻底堵死。
 *
 * 必须包在闸门**内层**（withGate(withTimeout(p))），超时才能让闸门正常释放并触发重试。
 * 包在外层的话闸门内部依然挂着，死锁照旧。
 */
export function withTimeout(
  inner: IsochroneProvider,
  ms: number = DEFAULT_TIMEOUT_MS,
): IsochroneProvider {
  return {
    id: inner.id,
    supportedModes: inner.supportedModes,
    fetch(req) {
      return new Promise<PolyFeature | null>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new ProviderTimeoutError(req.minutes, ms))
        }, ms)

        inner.fetch(req).then(
          (result) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(result)
          },
          (err) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(err)
          },
        )
      })
    },
  }
}
