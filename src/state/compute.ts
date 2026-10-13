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
}

/** 分别设置模式每个起点只允许一个时间。 */
export function normalizeCustomThresholds(
  thresholds: number[],
  fallback = 30,
): number[] {
  const selected = thresholds[0] ?? fallback
  return [Math.min(MAX_MINUTES, Math.max(1, Math.round(selected)))]
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
    const thresholds = bandMode === 'paired'
      ? globalThresholds
      : normalizeCustomThresholds(o.thresholds, globalThresholds[0] ?? 30)
    for (const minutes of thresholds) {
      if (minutes <= 0 || minutes > MAX_MINUTES) continue
      out.push({ originId: o.id, minutes, lngLat: o.lngLat, mode: o.mode })
    }
  }
  return out
}

/** 滑条提交：撤掉旧的自定义档、放入新档并保持有序。预设档不受影响 */
export function applyCustomThreshold(thresholds: number[], prev: number, next: number): number[] {
  const rest = thresholds.filter((m) => m !== prev && m !== next)
  return [...rest, next].sort((a, b) => a - b)
}

export type ComputeBandInput = {
  op: SetOp
  minutes: number
  originIds: string[]
  cells: Map<string, CellStatus>
  geoms: Map<string, PolyFeature | null>
  baseOriginId: string | null
}

export type ComputeCustomBandInput = Omit<ComputeBandInput, 'minutes'> & {
  minutesByOrigin: ReadonlyMap<string, number>
}

type ComputeSelectionInput = Omit<ComputeBandInput, 'minutes'> & {
  minutesByOrigin: ReadonlyMap<string, number>
}

/**
 * 对一组「起点 → 时间」选择做集合运算。
 *
 * 统一时间与分别设置最终都走这里，避免分别设置时错用某个
 * 全局档位查找所有起点的数据。
 */
function computeSelection(input: ComputeSelectionInput): BandResult {
  const { op, originIds, cells, geoms, baseOriginId, minutesByOrigin } = input

  // 把「点 × 档」的格状态投影成本次选择的「点 → 状态」。
  const bandCells = new Map<string, CellStatus>()
  for (const id of originIds) {
    const minutes = minutesByOrigin.get(id)
    if (minutes === undefined) continue
    const status = cells.get(cellKey(id, minutes))
    if (status) bandCells.set(id, status)
  }

  const status = resolveBandStatus(bandCells, originIds)
  if (status.kind !== 'ready') return status

  const present: PolyFeature[] = []
  const byOrigin = new Map<string, PolyFeature>()
  for (const id of originIds) {
    const minutes = minutesByOrigin.get(id)
    if (minutes === undefined) continue
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

/** 统一时间：所有起点使用同一档位。 */
export function computeBand(input: ComputeBandInput): BandResult {
  return computeSelection({
    ...input,
    minutesByOrigin: new Map(input.originIds.map((id) => [id, input.minutes])),
  })
}

/** 分别设置：每个起点使用自己选中的档位，输出一个合成结果。 */
export function computeCustomBand(input: ComputeCustomBandInput): BandResult {
  return computeSelection(input)
}
