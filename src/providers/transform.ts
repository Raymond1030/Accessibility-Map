import { polygon } from '@turf/turf'
import { normalize, type PolyFeature } from '../geometry/ops'

/**
 * result.bounds 的形状实测下来并不统一，所以这里不写死类型。
 *
 * 线上真实返回的是 bounds[块][环][点]，且点是 ["116.3069", "40.052399"]
 * 这样的**字符串**数组；文档和部分示例里则是 bounds[路径][{lng, lat}] 两层。
 * 解析器对两者都兼容，靠识别「点」来定位环，而不是假定嵌套深度。
 */
export type AmapBounds = unknown

type Coord = [number, number]

/** 逐点坐标变换。v1 全栈 GCJ-02 时不需要它；现在出口要转 WGS-84，由调用方注入 */
export type CoordConvert = (c: Coord) => Coord

function toCoord(v: unknown): Coord | null {
  if (Array.isArray(v) && v.length >= 2) {
    const lng = Number(v[0])
    const lat = Number(v[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }
  if (v && typeof v === 'object') {
    const o = v as { lng?: unknown; lat?: unknown }
    if (o.lng !== undefined && o.lat !== undefined) {
      const lng = Number(o.lng)
      const lat = Number(o.lat)
      return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
    }
  }
  return null
}

/** 一个数组的元素全是点，它就是一个环 */
function asRing(node: unknown): Coord[] | null {
  if (!Array.isArray(node) || node.length === 0) return null
  const coords: Coord[] = []
  for (const item of node) {
    const c = toCoord(item)
    if (!c) return null
    coords.push(c)
  }
  return coords
}

/**
 * 递归找出所有环，不关心 bounds 到底嵌套了几层。
 *
 * 已知简化：带洞的多边形会被拆成独立的外环，洞被填实。
 * 公交等时圈里「可达区中间的不可达孤岛」极少见，为此引入外环/内环判定
 * 不划算——真遇到了再说。
 */
function collectRings(node: unknown, out: Coord[][]): void {
  const ring = asRing(node)
  if (ring) {
    out.push(ring)
    return
  }
  if (!Array.isArray(node)) return
  for (const child of node) collectRings(child, out)
}

/** 环 → Polygon。高德的环不闭合，GeoJSON 要求首尾相同，这里补上 */
export function boundsToPolygons(bounds: AmapBounds, convert?: CoordConvert): PolyFeature[] {
  const rings: Coord[][] = []
  collectRings(bounds, rings)

  const out: PolyFeature[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const converted = convert ? ring.map(convert) : ring
    const closed: Coord[] = [...converted]
    const [fx, fy] = closed[0]
    const [lx, ly] = closed[closed.length - 1]
    if (fx !== lx || fy !== ly) closed.push([fx, fy])
    out.push(polygon([closed]) as PolyFeature)
  }
  return out
}

/**
 * Provider 出口的契约：无论高德返回多少块重叠区域，
 * 下游拿到的永远是一个干净、无自交的规范要素（或 null 表示无覆盖）。
 */
export function boundsToNormalizedFeature(
  bounds: AmapBounds,
  convert?: CoordConvert,
): PolyFeature | null {
  return normalize(boundsToPolygons(bounds, convert))
}

export type ArrivalRangeResult =
  | { ok: true; bounds: AmapBounds }
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

  const r = result as { bounds?: AmapBounds; info?: string; infocode?: string }

  if (r.infocode && r.infocode !== '10000') {
    return { ok: false, error: r.info ?? r.infocode }
  }

  if (status === 'error') {
    return { ok: false, error: r.info ?? status }
  }

  return { ok: true, bounds: r.bounds ?? [] }
}
