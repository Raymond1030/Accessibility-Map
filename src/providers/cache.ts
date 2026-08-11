import type { Mode, TransitPolicy } from '../types'
import type { PolyFeature } from '../geometry/ops'

export type IsochroneRequest = {
  lngLat: [number, number]
  mode: Mode
  minutes: number
  policy?: TransitPolicy
}

export interface IsochroneProvider {
  id: string
  supportedModes: readonly Mode[]
  /** null 表示该点周边无可达数据——这是有效结果，不是错误 */
  fetch(req: IsochroneRequest): Promise<PolyFeature | null>
}

export function requestFingerprint(providerId: string, req: IsochroneRequest): string {
  const [lng, lat] = req.lngLat
  return [
    providerId,
    `${lng.toFixed(5)},${lat.toFixed(5)}`,
    req.mode,
    req.policy ?? 'ALL',
    req.minutes,
  ].join('|')
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
