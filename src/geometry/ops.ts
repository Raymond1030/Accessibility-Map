import { featureCollection, intersect, union, difference, simplify } from '@turf/turf'
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson'

export type PolyFeature = Feature<Polygon | MultiPolygon>

/** 约 10 米。等时圈本身精度远粗于此，简化不损失有效信息，但能把布尔运算量降一到两个数量级 */
export const SIMPLIFY_TOLERANCE = 0.0001

/**
 * 几何自带的细节精度（度），以几何对象为键。平滑过的 Mapbox 轮廓已经在约 0.025 格以内抽稀过，
 * 再按 10 米简化会把圆滑的曲线削回折线，集合运算的结果也会偏离地图上画出的轮廓线——
 * 所以简化时取两者中较细的那个。没有登记的几何照旧按 SIMPLIFY_TOLERANCE 简化。
 * 登记随几何对象走：只换 properties 的浅拷贝仍然有效；深拷贝后丢失，退回默认精度。
 */
const detail = new WeakMap<object, number>()

/** 登记 f 的细节精度（度），之后 simplifyForOps 不会比它简化得更粗。返回 f 本身 */
export function keepDetail<T extends PolyFeature>(f: T, tolerance: number): T {
  if (f.geometry && tolerance > 0 && Number.isFinite(tolerance)) detail.set(f.geometry, tolerance)
  return f
}

function detailOf(f: PolyFeature): number | undefined {
  return f.geometry ? detail.get(f.geometry) : undefined
}

/**
 * 登记过精度、顶点又不多的几何（步行圈、地铁步行段和它们的并集）直接参与运算：
 * 布尔运算本来就快，而 DP 没有转角约束，会把小半径的圆弧再削出 30° 以上的折角
 */
const SMALL_DETAILED = 1500

function vertexCount(g: Polygon | MultiPolygon): number {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  let n = 0
  for (const poly of polys) for (const ring of poly) n += ring.length
  return n
}

export function simplifyForOps(f: PolyFeature): PolyFeature {
  const fine = detailOf(f)
  if (fine !== undefined && vertexCount(f.geometry) <= SMALL_DETAILED) return f
  const tolerance = fine === undefined ? SIMPLIFY_TOLERANCE : Math.min(SIMPLIFY_TOLERANCE, fine)
  const s = simplify(f, { tolerance, highQuality: false }) as PolyFeature
  // Douglas–Peucker 不保拓扑：细长尖角的两侧可能被折成交叉的「蝴蝶结」。
  // 原本没有交叉时宁可不简化——单个起点的结果不经布尔运算，会原样画出和导出
  if (hasProperCrossing(s) && !hasProperCrossing(f)) return f
  return fine === undefined ? s : keepDetail(s, tolerance)
}

type Segment = { ax: number; ay: number; bx: number; by: number; x0: number; x1: number; y0: number; y1: number; ring: number; i: number; n: number }

/**
 * 是否有两条不相邻的边真正交叉（交点落在两条边的内部）。只是接触、共点或共线不算。
 * 按左端点排序扫描，只比较 x 区间重叠的边；等时圈的边又短又多，接近线性。
 */
function hasProperCrossing(f: PolyFeature): boolean {
  const g = f.geometry
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return false
  const polys: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  const segs: Segment[] = []
  let ring = 0
  for (const poly of polys) for (const r of poly) {
    const n = r.length - 1
    for (let i = 0; i < n; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1]
      segs.push({
        ax, ay, bx, by, ring, i, n,
        x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by),
      })
    }
    ring++
  }
  segs.sort((s, t) => s.x0 - t.x0)
  const active: Segment[] = []
  for (const s of segs) {
    let kept = 0
    for (let k = 0; k < active.length; k++) {
      const t = active[k]
      if (t.x1 < s.x0) continue // 已在扫描线左侧，之后的边都碰不到它
      active[kept++] = t
      if (t.y1 < s.y0 || s.y1 < t.y0) continue
      if (t.ring === s.ring) {
        const d = Math.abs(t.i - s.i)
        if (d <= 1 || d === s.n - 1) continue // 相邻边本来就共用端点
      }
      if (crossesProperly(s, t)) return true
    }
    active.length = kept
    active.push(s)
  }
  return false
}

function crossesProperly(s: Segment, t: Segment): boolean {
  const d1 = orient(s.ax, s.ay, s.bx, s.by, t.ax, t.ay)
  const d2 = orient(s.ax, s.ay, s.bx, s.by, t.bx, t.by)
  if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) return false
  const d3 = orient(t.ax, t.ay, t.bx, t.by, s.ax, s.ay)
  const d4 = orient(t.ax, t.ay, t.bx, t.by, s.bx, s.by)
  return (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/**
 * 把一组可能相互重叠、可能自相交的多边形并成一个规范要素。
 * Provider 出口必须调用它——高德返回的公交可达域是沿线路撒开的几十上百块重叠区域，
 * 不归一化直接做布尔运算会得到错误结果或卡死。
 */
export function normalize(polys: PolyFeature[]): PolyFeature | null {
  if (polys.length === 0) return null
  if (polys.length === 1) return polys[0]
  const merged = (union(featureCollection(polys)) as PolyFeature | null) ?? null
  // 并集的顶点都来自输入，输入里最细的细节精度也就是它的精度（地铁步行圈靠这一步保持圆滑）
  let fine = Infinity
  for (const p of polys) fine = Math.min(fine, detailOf(p) ?? Infinity)
  return merged && Number.isFinite(fine) ? keepDetail(merged, fine) : merged
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
