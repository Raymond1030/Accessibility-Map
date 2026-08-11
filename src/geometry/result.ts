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

export function formatArea(sqm: number): string {
  if (sqm >= 1_000_000) return `${(sqm / 1_000_000).toFixed(2)} km²`
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
