import { booleanPointInPolygon, point } from '@turf/turf'
import type { PolyFeature } from '../geometry/ops'
import type { MetroStation } from './types'
import type { MetroEntry } from './graph'

export type AccessContour = {
  minutes: number
  /** null 表示该档等时圈无覆盖 */
  feature: PolyFeature | null
}

/**
 * 用一组从小到大的接驳等时圈估算「到每个车站要多久」：
 * 车站落进哪一档最小的圈，接驳时间就按那一档算。
 *
 * 这是保守的向上取整——真实时间在 (上一档, 该档] 区间里。宁可高估进站时间
 * 也不低估：等时圈的语义是「T 分钟内**一定**可达」，高估只缩小结果，不会画大饼。
 */
export function estimateAccess(
  stations: MetroStation[],
  contours: AccessContour[],
): MetroEntry[] {
  const sorted = [...contours]
    .filter((c) => c.feature !== null)
    .sort((a, b) => a.minutes - b.minutes)
  if (sorted.length === 0) return []

  const out: MetroEntry[] = []
  for (const s of stations) {
    const p = point(s.lngLat)
    for (const c of sorted) {
      if (booleanPointInPolygon(p, c.feature!)) {
        out.push({ stationId: s.id, accessMin: c.minutes })
        break
      }
    }
  }
  return out
}
