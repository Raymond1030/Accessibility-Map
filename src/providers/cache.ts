import type { Mode } from '../types'
import type { PolyFeature } from '../geometry/ops'

export type IsochroneRequest = {
  lngLat: [number, number]
  mode: Mode
  minutes: number
}

export interface IsochroneProvider {
  id: string
  supportedModes: readonly Mode[]
  /** null 表示该点周边无可达数据——这是有效结果，不是错误 */
  fetch(req: IsochroneRequest): Promise<PolyFeature | null>
}

const TRAFFIC_BUCKET_MS = 600_000

export function requestFingerprint(
  providerId: string,
  req: IsochroneRequest,
  now: number = Date.now(),
): string {
  const [lng, lat] = req.lngLat
  // 实时路况会随时间变化，指纹拼入 10 分钟时间桶：
  // 同一时段内切运算/拖回原点仍零请求，跨时段重新获取。
  // now 可注入，保持纯函数可测。
  const bucket = req.mode === 'driving-traffic'
    ? `|t${Math.floor(now / TRAFFIC_BUCKET_MS)}`
    : ''
  return [
    providerId,
    `${lng.toFixed(5)},${lat.toFixed(5)}`,
    req.mode,
    req.minutes,
  ].join('|') + bucket
}

/**
 * 参数指纹缓存。它带来三个直接结果：
 *   切换交集/并集/差集 零请求；点拖走再拖回 零请求；新增一个档位 只请求那一档。
 * 同时合并在飞的相同请求，避免重复点击打出两份。
 */
export function withCache(inner: IsochroneProvider): IsochroneProvider {
  const done = new Map<string, PolyFeature | null>()
  const inFlight = new Map<string, Promise<PolyFeature | null>>()

  return {
    id: inner.id,
    supportedModes: inner.supportedModes,
    async fetch(req) {
      const key = requestFingerprint(inner.id, req)
      if (done.has(key)) return done.get(key)!

      const flying = inFlight.get(key)
      if (flying) return flying

      const p = inner.fetch(req)
        .then((result) => {
          done.set(key, result)
          return result
        })
        .finally(() => {
          inFlight.delete(key)
        })

      inFlight.set(key, p)
      return p
    },
  }
}
