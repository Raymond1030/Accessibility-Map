import { polygon } from '@turf/turf'
import { normalize, type PolyFeature } from '../geometry/ops'

/** 高德回调里 result.bounds 的元素形状 */
export type AmapPath = Array<{ lng: number; lat: number }>

/**
 * 一条路径转一个 Polygon。
 * 高德的路径不闭合，GeoJSON 的环必须首尾相同，这里补上。
 */
export function boundsToPolygons(bounds: AmapPath[]): PolyFeature[] {
  const out: PolyFeature[] = []
  for (const path of bounds) {
    if (!path || path.length < 3) continue
    const ring: [number, number][] = path.map((p) => [p.lng, p.lat])
    const [fx, fy] = ring[0]
    const [lx, ly] = ring[ring.length - 1]
    if (fx !== lx || fy !== ly) ring.push([fx, fy])
    out.push(polygon([ring]) as PolyFeature)
  }
  return out
}

/**
 * Provider 出口的契约：无论高德返回多少块重叠区域，
 * 下游拿到的永远是一个干净、无自交的规范要素（或 null 表示无覆盖）。
 */
export function boundsToNormalizedFeature(bounds: AmapPath[]): PolyFeature | null {
  return normalize(boundsToPolygons(bounds))
}

export type ArrivalRangeResult =
  | { ok: true; bounds: AmapPath[] }
  | { ok: false; error: string }

/**
 * 判定 ArrivalRange 回调的成败。
 *
 * 不能只看 status —— 实测高德在**有数据时也会返回 `no_data`**，
 * 同时 infocode 是 10000（成功）、bounds 里有几十块多边形。
 * 只认 `status === 'complete'` 会把正常的成功响应当成失败丢掉。
 *
 * 所以以实际内容为准：
 *   result 是字符串        → 那是错误码（如 INVALID_USER_DOMAIN）
 *   infocode 存在且非 10000 → 失败，用 info 作为错误信息
 *   其余                    → 成功，bounds 为空表示该点周边确实无公交覆盖
 */
export function interpretArrivalRangeResult(
  status: string,
  result: unknown,
): ArrivalRangeResult {
  if (typeof result === 'string') {
    return { ok: false, error: result }
  }

  if (!result || typeof result !== 'object') {
    return { ok: false, error: status || 'UNKNOWN_ERROR' }
  }

  const r = result as { bounds?: AmapPath[]; info?: string; infocode?: string }

  if (r.infocode && r.infocode !== '10000') {
    return { ok: false, error: r.info ?? r.infocode }
  }

  if (status === 'error') {
    return { ok: false, error: r.info ?? status }
  }

  return { ok: true, bounds: r.bounds ?? [] }
}
