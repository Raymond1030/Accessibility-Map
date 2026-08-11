import { featureCollection, intersect, union, difference, simplify } from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'

export type PolyFeature = Feature<Polygon | MultiPolygon>

/** 约 10 米。等时圈本身精度远粗于此，简化不损失有效信息，但能把布尔运算量降一到两个数量级 */
export const SIMPLIFY_TOLERANCE = 0.0001

export function simplifyForOps(f: PolyFeature): PolyFeature {
  return simplify(f, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false }) as PolyFeature
}

/**
 * 把一组可能相互重叠、可能自相交的多边形并成一个规范要素。
 * Provider 出口必须调用它——高德返回的公交可达域是沿线路撒开的几十上百块重叠区域，
 * 不归一化直接做布尔运算会得到错误结果或卡死。
 */
export function normalize(polys: PolyFeature[]): PolyFeature | null {
  if (polys.length === 0) return null
  if (polys.length === 1) return polys[0]
  return (union(featureCollection(polys)) as PolyFeature | null) ?? null
}

export function unionAll(features: PolyFeature[]): PolyFeature | null {
  if (features.length === 0) return null
  if (features.length === 1) return features[0]
  return (union(featureCollection(features)) as PolyFeature | null) ?? null
}

/** 逐对求交。任一步为空则整体为空——这是正确的短路，不是提前退出的优化 */
export function intersectAll(features: PolyFeature[]): PolyFeature | null {
  if (features.length === 0) return null
  let acc: PolyFeature | null = features[0]
  for (let i = 1; i < features.length; i++) {
    if (acc === null) return null
    acc = (intersect(featureCollection([acc, features[i]])) as PolyFeature | null) ?? null
  }
  return acc
}

/** base \ (others[0] ∪ others[1] ∪ …)。Turf 7 的 difference 原生就是首项减去其余全部 */
export function differenceFrom(base: PolyFeature, others: PolyFeature[]): PolyFeature | null {
  if (others.length === 0) return base
  return (difference(featureCollection([base, ...others])) as PolyFeature | null) ?? null
}
