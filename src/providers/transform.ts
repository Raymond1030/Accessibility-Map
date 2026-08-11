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
