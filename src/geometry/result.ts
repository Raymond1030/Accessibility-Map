import { area } from '@turf/turf'
import type { PolyFeature } from './ops'

export type CellStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error'

export type BandStatus =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; missing: string[] }

export type BandResult =
  | { kind: 'ok'; geometry: PolyFeature; areaSqM: number }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; missing: string[] }

export function areaOf(f: PolyFeature): number {
  return area(f)
}

/**
 * 阈值定在 1 公顷而非 1 km²：等时圈的面积普遍是几十万平方米，
 * 「490630 m²」得数位数才知道是半个平方公里，而「0.49 km²」一眼可读。
 * 低于 1 公顷时数字本身已经够短，用 m² 反而更直观。
 */
export function formatArea(sqm: number): string {
  if (sqm >= 10_000) return `${(sqm / 1_000_000).toFixed(2)} km²`
  return `${Math.round(sqm)} m²`
}

/**
 * 决定某个档位能否参与集合运算。
 *
 * 关键规则：任一必需起点在该档为 error 或尚未有数据时，整档判为 unavailable。
 * 绝不能拿残缺的点集合去算交集——那会得出一个看起来完全正常、实则错误的结果。
 *
 * 注意 'empty'（该点周边无公交覆盖）是有效数据，不阻断运算：
 * 它参与交集会正确地导致空交集，这本身就是要传达的结论。
 */
export function resolveBandStatus(
  cells: Map<string, CellStatus>,
  requiredOriginIds: string[],
): BandStatus {
  if (requiredOriginIds.length === 0) return { kind: 'unavailable', missing: [] }

  const missing: string[] = []
  let loading = false

  for (const id of requiredOriginIds) {
    const status = cells.get(id)
    if (status === 'loading') loading = true
    else if (status !== 'ok' && status !== 'empty') missing.push(id)
  }

  if (missing.length > 0) return { kind: 'unavailable', missing }
  if (loading) return { kind: 'loading' }
  return { kind: 'ready' }
}
