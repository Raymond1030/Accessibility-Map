import { cellKey, MAX_MINUTES, type BandMode, type Origin, type SetOp } from '../types'
import {
  differenceFrom, intersectAll, simplifyForOps, unionAll, type PolyFeature,
} from '../geometry/ops'
import { areaOf, resolveBandStatus, type BandResult, type CellStatus } from '../geometry/result'

export type PlannedRequest = {
  originId: string
  minutes: number
  lngLat: [number, number]
  mode: Origin['mode']
  policy: Origin['policy']
}

/** 把当前状态摊平成「点 × 档位」的请求矩阵。隐藏的点与超限的档位在这里被剔除 */
export function planRequests(
  origins: Origin[],
  bandMode: BandMode,
  globalThresholds: number[],
): PlannedRequest[] {
  const out: PlannedRequest[] = []
  for (const o of origins) {
    if (!o.visible) continue
    const thresholds = bandMode === 'paired' ? globalThresholds : o.thresholds
    for (const minutes of thresholds) {
      if (minutes <= 0 || minutes > MAX_MINUTES) continue
      out.push({
        originId: o.id, minutes, lngLat: o.lngLat, mode: o.mode, policy: o.policy,
      })
    }
  }
  return out
}

export type ComputeBandInput = {
  op: SetOp
  minutes: number
  originIds: string[]
  cells: Map<string, CellStatus>
  geoms: Map<string, PolyFeature | null>
  baseOriginId: string | null
}

export function computeBand(input: ComputeBandInput): BandResult {
  const { op, minutes, originIds, cells, geoms, baseOriginId } = input

  // 把「点 × 档」的格状态投影成该档内的「点 → 状态」，再判定整档是否可运算
  const bandCells = new Map<string, CellStatus>()
  for (const id of originIds) {
    const status = cells.get(cellKey(id, minutes))
    if (status) bandCells.set(id, status)
  }

  const status = resolveBandStatus(bandCells, originIds)
  if (status.kind !== 'ready') return status

  const present: PolyFeature[] = []
  const byOrigin = new Map<string, PolyFeature>()
  for (const id of originIds) {
    const g = geoms.get(cellKey(id, minutes))
    if (g) {
      const s = simplifyForOps(g)
      present.push(s)
      byOrigin.set(id, s)
    }
  }

  let result: PolyFeature | null = null

  if (op === 'intersect') {
    // 有点无覆盖（几何为 null）时，交集必然为空——这是正确结论，不是缺数据
    result = present.length === originIds.length ? intersectAll(present) : null
  } else if (op === 'union') {
    result = unionAll(present)
  } else {
    if (!baseOriginId) return { kind: 'unavailable', missing: [] }
    const base = byOrigin.get(baseOriginId)
    if (!base) return { kind: 'empty' }
    const others = originIds
      .filter((id) => id !== baseOriginId)
      .map((id) => byOrigin.get(id))
      .filter((g): g is PolyFeature => Boolean(g))
    result = differenceFrom(base, others)
  }

  if (!result) return { kind: 'empty' }
  return { kind: 'ok', geometry: result, areaSqM: areaOf(result) }
}
