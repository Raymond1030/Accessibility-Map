import type { BBox, MultiPolygon, Polygon, Position } from 'geojson'
import { keepDetail, type PolyFeature } from './ops'

/**
 * Mapbox 等时圈去锯齿。
 *
 * Mapbox Isochrone（Valhalla）先在经纬度网格上算到达时间，再描等值线。网格边长实测为：
 * 驾车 5–15 分钟 0.001°（约 110 米）、20–30 分钟 0.002°、40–50 分钟 0.003°、60 分钟 0.004°，
 * 步行、骑行一律 0.001°。轮廓沿格子边走，放大后是一级级直角台阶——那是网格量化的痕迹，
 * 不是道路的形状。真实边界本来就落在边缘那一格里的某处，所以在半格以内取一条顺滑的线，
 * 并不比台阶更不准确。
 *
 * 全部计算在局部平面坐标里进行（x 按纬度余弦缩放，单位都是「纬度度数」，格长可直接当长度用）：
 *   0. 短于 0.12 格的小倒角先收回成直角，让每个台阶角都按同一方式处理；
 *   A. 每条边从中点切开（长于 5 格的边在离两端 2.5 格处切开，中段保持笔直）。规则台阶的
 *      各边中点共线，连起来就是一条直的斜线。每个原始角另留一个「张力点」，位置按角求解，
 *      保证最终曲线离该角不超过 H 格——切多深是绝对量，与边长无关，大转角不会被削成椭圆；
 *   B. 每个折点换成与两侧相切的二次贝塞尔圆弧（Chaikin 割角的极限形状），按转角均匀采样；
 *   C. 在 0.025 格以内抽稀，顶点数控制在原来的约 2.5 倍，且不产生超过 24° 的折角；
 *   D. 割角会让凸出处略微收缩：面积变化超过 0.2% 时，把原轮廓整体外扩/内缩一点后重做；
 *   E. 校验：坐标有限、面积与方向合理、任意两条不相邻的边既不相交也不接触、没有折返的针尖、
 *      洞仍在外环内且互不嵌套、多部件互不接触也不嵌套。不通过就把出问题处附近的原始角
 *      钉住（保持原样）重做，半径逐轮扩大；再不行降到半强度；最后保留原始坐标。
 *
 * 因此输出要么通过全部校验，要么就是原始坐标——不会把有效的几何变成无效的几何。
 * 平滑过的输出会登记自身的抽稀精度（C 步的 0.025 格，见 ops.ts 的 keepDetail），集合运算前的
 * simplifyForOps 不会再按 10 米把曲线削回折线。
 * 只应对 Mapbox 原始轮廓调用一次：对已平滑的结果再平滑只会徒增顶点。
 */

export type SmoothTuning = {
  /** 原始台阶角到最终曲线的距离上限（格）。0.4 时 1:1、1:2 的台阶都会被拉直，整体偏差约半格以内 */
  H: number
  /** A 步切口离端点的最远距离（格）：长于 2×A1 的边保留笔直的中段 */
  A1: number
  /** B 步圆弧单侧臂长上限（格） */
  A2: number
  /** 圆弧采样时每个顶点的最大转角（度） */
  segDeg: number
  /** 圆弧采样的最大弦高（格） */
  sag: number
  /** A 步转角小于此值（度）的顶点不再加圆弧 */
  minTurnDeg: number
  /** 臂长短于此值（格）的圆弧不采样 */
  minArm: number
  /** A 步相距小于此值（格）的点合并 */
  mergeTol: number
  /** 短于此值（格）的输入边先收回成一个角 */
  shortEdge: number
  /** 输出中相距小于此值（格）的点合并 */
  minSeg: number
  /** 抽稀后任一顶点的最大转角（度） */
  maxTurnDeg: number
  /** 抽稀允许的最大偏离（格） */
  simplifyTol: number
  /** 抽稀目标：每个输入顶点约对应多少个输出顶点 */
  budget: number
  /** 是否做 D 步面积补偿 */
  restoreArea: boolean
  /** 面积变化超过此比例才补偿 */
  areaTol: number
  /**
   * 面积补偿的最大外扩/内缩量（格）。只有几格宽的小圈（短距离步行）割角后会缩 10% 以上，
   * 要外扩约 0.1 格才补得回来；大圈只需百分之几格，不受这个上限影响
   */
  maxShift: number
}

export type SmoothOptions = Partial<SmoothTuning> & {
  /**
   * 网格边长上限（度）。估计时只在不超过它的候选里取值，用来挡住「把两格的台阶当成一格」
   * 这类高估——高估会让平滑过头。由调用方按出行方式与时长给出。
   */
  maxCellDeg?: number
}

const DEFAULTS: SmoothTuning = {
  H: 0.4,
  A1: 2.5,
  A2: 1.25,
  segDeg: 20,
  sag: 0.01,
  minTurnDeg: 1,
  minArm: 0.004,
  mergeTol: 0.02,
  shortEdge: 0.12,
  minSeg: 1e-4,
  maxTurnDeg: 24,
  simplifyTol: 0.025,
  budget: 2.5,
  restoreArea: true,
  areaTol: 0.002,
  maxShift: 0.15,
}

type Pt = [number, number]
/** 局部坐标下的开环（不含重复的闭合点） */
type Ring = Pt[]
type RingResult = { base: Ring; adjusted: Ring }
type Check = { ok: boolean; points: Pt[] }

const M_LAT = 110574
const M_LNG = 111320
const DEG = Math.PI / 180

/** 平滑一个 Mapbox 等时圈。几何类型、properties、id 保持不变；任何意外都原样返回输入 */
export function smoothIsochrone(feature: PolyFeature, options: SmoothOptions = {}): PolyFeature {
  try {
    return smooth(feature, options)
  } catch (error) {
    if (import.meta.env.DEV) console.warn('等时圈平滑失败，保留原始轮廓', error)
    return feature
  }
}

function smooth(feature: PolyFeature, options: SmoothOptions): PolyFeature {
  const geom = feature?.geometry
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return feature
  const polys: Position[][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  if (!wellFormed(polys)) return feature
  const o: SmoothTuning = { ...DEFAULTS, ...options }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys) for (const ring of poly) for (const p of ring) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  const lng0 = (minX + maxX) / 2, lat0 = (minY + maxY) / 2
  const kx = Math.cos(lat0 * DEG) * M_LNG / M_LAT
  const toLocal = (ring: Position[]): Ring => ring.map(p => [(p[0] - lng0) * kx, p[1] - lat0])
  const toLngLat = (pts: Ring): Position[] => {
    const out = pts.map(p => [p[0] / kx + lng0, p[1] + lat0])
    out.push([out[0][0], out[0][1]])
    return out
  }

  const cell = estimateGridCell(polys, options.maxCellDeg)
  const localPolys = polys.map(poly => poly.map(r => dedupe(toLocal(r))))
  const chosen = localPolys.map(lp => smoothPolygon(lp, cell, o, [], 0, true))
  if (polys.length > 1) separateParts(localPolys, chosen, cell, o)

  const outPolys = polys.map((poly, i) => {
    const c = chosen[i]
    return c ? c.map(toLngLat) : poly.map(r => r.map(p => [p[0], p[1]]))
  })
  const geometry: Polygon | MultiPolygon = geom.type === 'Polygon'
    ? { type: 'Polygon', coordinates: outPolys[0] }
    : { type: 'MultiPolygon', coordinates: outPolys }
  if (geom.bbox) geometry.bbox = bboxOf(outPolys)
  const out: PolyFeature = { ...feature, geometry }
  if (feature.bbox) out.bbox = bboxOf(outPolys)
  // 全部保留原始坐标时什么也没平滑，不登记，照旧按默认精度简化
  return chosen.some(Boolean) ? keepDetail(out, o.simplifyTol * cell) : out
}

/** 每个环至少 4 个点、坐标都是有限数；不满足就不碰它 */
function wellFormed(polys: Position[][][]): boolean {
  if (!Array.isArray(polys) || polys.length === 0) return false
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length === 0) return false
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4) return false
      for (const p of ring) if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false
    }
  }
  return true
}

// 网格尺寸 ---------------------------------------------------------------------------------------
const FALLBACK_CELL = 0.001
const MIN_CELL = 0.0002
const MAX_CELL = 0.0045

/**
 * 估计网格边长（度）。Valhalla 等值线的顶点落在网格线上，相邻顶点的 |Δ经度|、|Δ纬度| 大量恰好是
 * 一格，所以按两位有效数字分桶后的众数就是格长（同票取小）。证据不足（少于 5 票或不到 3%）时
 * 退回 0.001°——Mapbox 最细的网格，宁可少平滑，不可多平滑。
 */
export function estimateGridCell(polys: Position[][][], maxCellDeg: number = MAX_CELL): number {
  const upper = Math.min(MAX_CELL, maxCellDeg)
  const counts = new Map<number, number>()
  let total = 0
  for (const poly of polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
    for (let axis = 0; axis < 2; axis++) {
      const d = Math.abs(ring[i][axis] - ring[i - 1][axis])
      if (!(d > MIN_CELL)) continue
      let e = Math.floor(Math.log10(d))
      let m = Math.round(d / 10 ** (e - 1))
      if (m >= 100) { m = 10; e++ }
      const key = e * 1000 + m
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total++
    }
  }
  let bestN = 0, best = NaN
  for (const [key, n] of counts) {
    const e = Math.floor(key / 1000)
    const v = (key - e * 1000) * 10 ** (e - 1)
    if (v > upper * (1 + 1e-9)) continue
    if (n > bestN || (n === bestN && v < best)) { bestN = n; best = v }
  }
  if (bestN >= 5 && bestN >= 0.03 * total && best >= MIN_CELL) return best
  return Math.min(FALLBACK_CELL, upper)
}

// 多边形 -----------------------------------------------------------------------------------------
/**
 * 平滑一个多边形（局部坐标、去重后的开环），返回通过全部校验的环，或 null（= 保留原始坐标）。
 * 校验失败会报告位置：把那里附近（半径逐轮扩大）的原始角钉住再做，一处窄颈不连累整圈。
 * 每个强度（1，然后 0.5）依次尝试：面积补偿后的结果 → 未补偿的结果 → 钉住冲突处后重试。
 */
function smoothPolygon(lp: Ring[], cell: number, o: SmoothTuning, pinPoints: Pt[], level: number, allowArea: boolean): Ring[] | null {
  const pins = lp.map(r => new Uint8Array(r.length))
  let radius = 1.5 * cell * (1 + level)
  if (pinPoints.length) pinNear(pins, lp, pinPoints, radius)
  for (const strength of [1, 0.5]) {
    for (let round = 0; round < 4; round++) {
      const res: RingResult[] = []
      for (let k = 0; k < lp.length; k++) {
        const r = smoothRing(lp[k], cell, o, strength, pins[k], allowArea)
        if (!r) break
        res.push(r)
      }
      if (res.length < lp.length) break
      if (res.some(r => r.adjusted !== r.base)) {
        const adjusted = res.map(r => r.adjusted)
        if (polygonCheck(adjusted, lp, cell).ok) return adjusted
      }
      const base = res.map(r => r.base)
      const check = polygonCheck(base, lp, cell)
      if (check.ok) return base
      if (!check.points.length) break
      radius += 1.5 * cell
      if (!pinNear(pins, lp, check.points, radius)) break
    }
  }
  return null
}

/**
 * 多部件必须互不接触、互不嵌套。冲突的部件依次：去掉面积补偿重做（外扩可能合上窄缝）→
 * 钉住冲突处附近的原始角重做（半径逐轮扩大）→ 退回原始坐标。最后整体复核，
 * 仍牵涉冲突的平滑部件一律退回原始坐标。
 */
function separateParts(localPolys: Ring[][], chosen: (Ring[] | null)[], cell: number, o: SmoothTuning): void {
  const current = () => chosen.map((c, i) => c ?? localPolys[i])
  const pinPts: Pt[][] = localPolys.map(() => [])
  const stage = localPolys.map(() => 0)
  for (let round = 0; round < 8; round++) {
    const { bad, points } = multiConflicts(current(), cell)
    let changed = false
    for (const i of bad) {
      if (!chosen[i]) continue
      stage[i]++
      if (stage[i] === 1) chosen[i] = smoothPolygon(localPolys[i], cell, o, pinPts[i], 0, false)
      else if (stage[i] <= 4 && points[i].length) {
        pinPts[i].push(...points[i])
        chosen[i] = smoothPolygon(localPolys[i], cell, o, pinPts[i], stage[i] - 1, false)
      } else chosen[i] = null
      changed = true
    }
    if (!changed) return
  }
  for (let guard = 0; guard <= chosen.length; guard++) {
    let changed = false
    for (const i of multiConflicts(current(), cell).bad) if (chosen[i]) { chosen[i] = null; changed = true }
    if (!changed) return
  }
}

/** 钉住任一给定点半径内的原始顶点；有新钉住的返回 true */
function pinNear(pins: Uint8Array[], lp: Ring[], points: Pt[], radius: number): boolean {
  const r2 = radius * radius, m = Math.min(points.length, 64)
  let added = false
  for (let k = 0; k < lp.length; k++) {
    const ring = lp[k], pin = pins[k]
    for (let i = 0; i < ring.length; i++) {
      if (pin[i]) continue
      const x = ring[i][0], y = ring[i][1]
      for (let j = 0; j < m; j++) {
        const dx = points[j][0] - x, dy = points[j][1] - y
        if (dx * dx + dy * dy <= r2) { pin[i] = 1; added = true; break }
      }
    }
  }
  return added
}

/** 去掉闭合重复点与相邻重复点 */
function dedupe(ring: Ring): Ring {
  const out: Ring = []
  for (const p of ring) {
    const q = out[out.length - 1]
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p)
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop()
  return out
}

// 单个环 -----------------------------------------------------------------------------------------
function smoothRing(ring: Ring, cell: number, o: SmoothTuning, strength: number, pins: Uint8Array, allowArea: boolean): RingResult | null {
  if (ring.length < 3) return null
  const col = collapseShortEdges(ring, pins, o.shortEdge * cell)
  const pts = col.pts
  if (pts.length < 3) return null
  const base = smoothOnce(pts, cell, o, strength, col.pins)
  if (!base) return null
  if (!o.restoreArea || !allowArea) return { base, adjusted: base }
  const A0 = signedArea(ring), A1 = signedArea(base)
  if (!(Math.abs(A1 - A0) > o.areaTol * Math.abs(A0))) return { base, adjusted: base }
  let per = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n]
    per += Math.hypot(q[0] - p[0], q[1] - p[1])
  }
  const maxShift = o.maxShift * cell * strength
  const d = Math.max(-maxShift, Math.min(maxShift, (A0 - A1) / per))
  const shifted = offsetRing(pts, d)
  const adjusted = shifted && smoothOnce(shifted, cell, o, strength, col.pins)
  return { base, adjusted: adjusted || base }
}

/**
 * 把短于 minLen 且不接触钉住角的边换成一个点：两侧邻边延长线的交点（离该边不超过 minLen 时），
 * 否则取中点。用来把插值或缓冲留下的小倒角还原成网格直角。
 */
function collapseShortEdges(pts: Ring, pins: Uint8Array, minLen: number): { pts: Ring; pins: Uint8Array } {
  let P = pts, Q = pins
  for (let pass = 0; pass < 4 && P.length > 4; pass++) {
    const n = P.length
    let longEdge = -1
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[i + 1 === n ? 0 : i + 1]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minLen) { longEdge = i; break }
    }
    if (longEdge < 0) break
    const start = longEdge + 1 === n ? 0 : longEdge + 1 // 从一条长边之后开始走
    const outP: Ring = [], outQ: number[] = []
    let changed = false, collapsed = 0
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n, j = (i + 1) % n
      const a = P[i], b = P[j]
      if (k < n - 1 && !Q[i] && !Q[j] && Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen && n - collapsed > 4) {
        const pa = P[(i - 1 + n) % n], pb = P[(j + 1) % n]
        let ux = a[0] - pa[0], uy = a[1] - pa[1], vx = pb[0] - b[0], vy = pb[1] - b[1]
        const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy)
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        let X: Pt = [mx, my]
        if (lu > 0 && lv > 0) {
          ux /= lu; uy /= lu; vx /= lv; vy /= lv
          const den = ux * vy - uy * vx
          if (Math.abs(den) > 0.17) { // 两条邻边不接近平行（夹角大于约 10°）
            const ex = b[0] - a[0], ey = b[1] - a[1]
            const t = (ex * vy - ey * vx) / den
            const x = a[0] + t * ux, y = a[1] + t * uy
            if (Math.hypot(x - mx, y - my) <= minLen) X = [x, y]
          }
        }
        outP.push(X)
        outQ.push(0)
        k++ // 顶点 j 已并入
        changed = true
        collapsed++
        continue
      }
      outP.push(a)
      outQ.push(Q[i])
    }
    if (!changed) break
    P = outP
    Q = Uint8Array.from(outQ)
  }
  return { pts: P, pins: Q }
}

function smoothOnce(pts: Ring, cell: number, o: SmoothTuning, strength: number, pins: Uint8Array): Ring | null {
  const H = o.H * cell * strength, A1 = o.A1 * cell * strength, A2 = o.A2 * cell * strength
  const a0 = midpointCut(pts, H, A1, A2, pins)
  const a = mergeClose(a0.pts, a0.caps, o.mergeTol * cell)
  if (a.pts.length < 3) return null
  const b = roundCorners(a.pts, a.caps, o.segDeg * DEG, o.minTurnDeg * DEG, o.sag * cell, o.minArm * cell)
  const c = cleanup(b, o.minSeg * cell)
  if (c.length < 3) return null
  return simplifyRing(c, o.simplifyTol * cell, o.maxTurnDeg * DEG, Math.max(8, Math.round(o.budget * pts.length)))
}

/** 沿右手法向偏移 d（逆时针环为向外），斜接；比 120° 更尖的角不动 */
function offsetRing(pts: Ring, d: number): Ring | null {
  const n = pts.length, out: Ring = new Array(n)
  for (let i = 0; i < n; i++) {
    const a = pts[i === 0 ? n - 1 : i - 1], b = pts[i], c = pts[i + 1 === n ? 0 : i + 1]
    let x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1]
    const l1 = Math.hypot(x1, y1), l2 = Math.hypot(x2, y2)
    if (!(l1 > 0 && l2 > 0)) return null
    x1 /= l1; y1 /= l1; x2 /= l2; y2 /= l2
    const k = 1 + y1 * y2 + x1 * x2 // 1 + cos(转角)
    out[i] = k < 0.5 ? b : [b[0] + d * (y1 + y2) / k, b[1] - d * (x1 + x2) / k]
  }
  return out
}

// A 步：中点切割 + 张力点 -------------------------------------------------------------------------
function midpointCut(pts: Ring, H: number, A1: number, A2: number, pins: Uint8Array): { pts: Ring; caps: number[] } {
  const n = pts.length
  const L = new Float64Array(n), ux = new Float64Array(n), uy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1
    const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1], l = Math.hypot(dx, dy)
    L[i] = l
    ux[i] = dx / l
    uy[i] = dy / l
  }
  const out: Ring = [], caps: number[] = [], sol = [0, 0]
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? n - 1 : i - 1, j = i + 1 === n ? 0 : i + 1
    const vx = pts[i][0], vy = pts[i][1]
    // 角 i 两侧的切点，也就是输出里张力点 C_i 的前后邻点
    const a = Math.min(L[p] / 2, A1), b = Math.min(L[i] / 2, A1)
    const Px = vx - a * ux[p], Py = vy - a * uy[p], Qx = vx + b * ux[i], Qy = vy + b * uy[i]
    const ex = Qx - Px, ey = Qy - Py, e2 = ex * ex + ey * ey
    let t = e2 > 0 ? ((vx - Px) * ex + (vy - Py) * ey) / e2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const Fx = Px + t * ex, Fy = Py + t * ey
    if (pins[i]) { sol[0] = 0; sol[1] = 0 } // 钉住的角：保持原点，不加圆弧
    else solveCorner(vx, vy, Px, Py, Qx, Qy, Fx, Fy, H, A2, sol)
    const lam = sol[0]
    out.push([vx + lam * (Fx - vx), vy + lam * (Fy - vy)])
    caps.push(sol[1])
    if (L[i] <= 2 * A1) {
      out.push([(vx + pts[j][0]) / 2, (vy + pts[j][1]) / 2])
      caps.push(A2)
    } else {
      out.push([vx + A1 * ux[i], vy + A1 * uy[i]])
      caps.push(A2)
      out.push([pts[j][0] - A1 * ux[i], pts[j][1] - A1 * uy[i]])
      caps.push(A2)
    }
  }
  return { pts: out, caps }
}

/**
 * 求张力点位置 lam（C 在 V 与弦上最近点 F 之间的比例）和 C 处圆弧的臂长上限，使圆整后的曲线
 * 离 V 恰为 H：直弦已够近时 lam = 1（台阶被拉直）；否则解 dist(lam) = H；若 C = V 仍太远
 * （尖角、尖刺），保持 C = V 并缩小圆弧。Illinois 割线法，约 6 步。
 */
function solveCorner(vx: number, vy: number, Px: number, Py: number, Qx: number, Qy: number, Fx: number, Fy: number, H: number, A2: number, out: number[]): void {
  const dxF = Fx - vx, dyF = Fy - vy, tol = 0.01 * H
  const g1 = localDist(vx, vy, Px, Py, Fx, Fy, Qx, Qy, A2) - H
  if (g1 <= tol) { out[0] = 1; out[1] = A2; return }
  // 闭式初值（对称臂、圆弧不受限时）：最终距离约为 (1 + 3 lam) / 4 * |F - V|
  const h = Math.hypot(dxF, dyF)
  let l0 = (4 * H / h - 1) / 3
  l0 = l0 < 0 ? 0 : l0 > 1 ? 1 : l0
  let a: number, fa: number, b: number, fb: number
  const gl = localDist(vx, vy, Px, Py, vx + l0 * dxF, vy + l0 * dyF, Qx, Qy, A2) - H
  if (Math.abs(gl) <= tol) { out[0] = l0; out[1] = A2; return }
  if (gl < 0) { a = l0; fa = gl; b = 1; fb = g1 } else {
    const g0 = l0 === 0 ? gl : localDist(vx, vy, Px, Py, vx, vy, Qx, Qy, A2) - H
    if (g0 > 0) {
      // C = V 时圆弧本身仍切得太深（尖角/尖刺）：保持 C = V，缩小圆弧（臂长为 0 时距离为 0，g = -H）
      let ra = 0, rfa = -H, rb = A2, rfb = g0, side = 0
      for (let k = 0; k < 8; k++) {
        const c = (ra * rfb - rb * rfa) / (rfb - rfa)
        const fc = localDist(vx, vy, Px, Py, vx, vy, Qx, Qy, c) - H
        if (Math.abs(fc) <= tol) { ra = c; break }
        if (fc > 0) { rb = c; rfb = fc; if (side === -1) rfa /= 2; side = -1 } else { ra = c; rfa = fc; if (side === 1) rfb /= 2; side = 1 }
      }
      out[0] = 0
      out[1] = ra
      return
    }
    a = 0; fa = g0; b = l0; fb = gl
  }
  // 对 g(lam) = dist - H 做 Illinois 割线法，始终保留可行端 a（g(a) <= 0）
  let side = 0
  for (let k = 0; k < 6; k++) {
    const c = (a * fb - b * fa) / (fb - fa)
    const fc = localDist(vx, vy, Px, Py, vx + c * dxF, vy + c * dyF, Qx, Qy, A2) - H
    if (Math.abs(fc) <= tol) { a = c; break }
    if (fc > 0) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1 } else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1 }
  }
  out[0] = a
  out[1] = A2
}

/** V 到 B 步在顶点 C 周围生成的曲线（直段 P..S、圆弧 S-C-E、直段 E..Q）的距离 */
function localDist(vx: number, vy: number, Px: number, Py: number, Cx: number, Cy: number, Qx: number, Qy: number, cap: number): number {
  const l1 = Math.hypot(Cx - Px, Cy - Py), l2 = Math.hypot(Qx - Cx, Qy - Cy)
  if (l1 === 0 || l2 === 0) return Math.sqrt(Math.min(segDist2(Px, Py, Cx, Cy, vx, vy), segDist2(Cx, Cy, Qx, Qy, vx, vy)))
  const al = Math.min(l1 / 2, cap), be = Math.min(l2 / 2, cap)
  const Sx = Cx - al * (Cx - Px) / l1, Sy = Cy - al * (Cy - Py) / l1
  const Ex = Cx + be * (Qx - Cx) / l2, Ey = Cy + be * (Qy - Cy) / l2
  const d2 = Math.min(segDist2(Px, Py, Sx, Sy, vx, vy), segDist2(Ex, Ey, Qx, Qy, vx, vy))
  // B(t) - V = A t² + Bv t + C0，其中 A = S - 2C + E，Bv = 2(C - S)，C0 = S - V
  const ax = Sx - 2 * Cx + Ex, ay = Sy - 2 * Cy + Ey, bx = 2 * (Cx - Sx), by = 2 * (Cy - Sy), cx = Sx - vx, cy = Sy - vy
  let bt = 0, bd = Infinity
  for (let k = 0; k <= 8; k++) {
    const t = k / 8, x = (ax * t + bx) * t + cx, y = (ay * t + by) * t + cy, d = x * x + y * y
    if (d < bd) { bd = d; bt = t }
  }
  // 在最佳采样点附近对 |B(t) - V|² 做两步牛顿迭代
  let t = bt
  for (let k = 0; k < 2; k++) {
    const x = (ax * t + bx) * t + cx, y = (ay * t + by) * t + cy
    const dx = 2 * ax * t + bx, dy = 2 * ay * t + by
    const f1 = x * dx + y * dy, f2 = dx * dx + dy * dy + x * 2 * ax + y * 2 * ay
    if (!(f2 > 0)) break
    t -= f1 / f2
    if (t < bt - 0.125) t = bt - 0.125
    else if (t > bt + 0.125) t = bt + 0.125
    if (t < 0) t = 0
    else if (t > 1) t = 1
  }
  const x = (ax * t + bx) * t + cx, y = (ay * t + by) * t + cy
  return Math.sqrt(Math.min(d2, bd, x * x + y * y))
}

/** 合并 A 步中相距小于 tol 的点（例如锐角处张力点落在切点上） */
function mergeClose(pts: Ring, caps: number[], tol: number): { pts: Ring; caps: number[] } {
  const P: Ring = [], C: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const q = P[P.length - 1]
    if (q && Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]) <= tol) {
      C[C.length - 1] = Math.min(C[C.length - 1], caps[i])
      continue
    }
    P.push(pts[i])
    C.push(caps[i])
  }
  while (P.length > 3 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) <= tol) {
    C[0] = Math.min(C[0], C[C.length - 1])
    P.pop()
    C.pop()
  }
  return { pts: P, caps: C }
}

// B 步：圆角 ------------------------------------------------------------------------------------
/** Chaikin 割角的极限：每个顶点 W 换成二次贝塞尔 S-W-E，臂长有上限，按切线角均匀采样 */
function roundCorners(pts: Ring, caps: number[], segRad: number, minTurn: number, sag: number, minArm: number): Ring {
  const n = pts.length
  const L = new Float64Array(n), ux = new Float64Array(n), uy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1
    const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1], l = Math.hypot(dx, dy)
    L[i] = l
    ux[i] = l > 0 ? dx / l : 0
    uy[i] = l > 0 ? dy / l : 0
  }
  const out: Ring = []
  let halfEnd = false // 上一个圆弧恰好止于公共边的中点
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? n - 1 : i - 1
    const wx = pts[i][0], wy = pts[i][1]
    const phi = Math.atan2(ux[p] * uy[i] - uy[p] * ux[i], ux[p] * ux[i] + uy[p] * uy[i]) // 有符号转角
    const aphi = Math.abs(phi)
    const al = Math.min(L[p] / 2, caps[i]), be = Math.min(L[i] / 2, caps[i])
    if (aphi < minTurn || L[p] === 0 || L[i] === 0 || Math.min(al, be) < minArm) {
      out.push([wx, wy])
      halfEnd = false
      continue
    }
    const Sx = wx - al * ux[p], Sy = wy - al * uy[p], Ex = wx + be * ux[i], Ey = wy + be * uy[i]
    const R = (al + be) / 2 / Math.tan(Math.min(aphi, 3) / 2) // 等效圆角半径
    const m = Math.max(1, Math.ceil(aphi / segRad), Math.ceil(aphi * Math.sqrt(R / (8 * sag))))
    if (!(halfEnd && al === L[p] / 2)) out.push([Sx, Sy])
    for (let k = 1; k < m; k++) {
      const g = phi * k / m, s1 = al * Math.sin(g), s2 = be * Math.sin(phi - g)
      const t = s1 / (s1 + s2), u = 1 - t
      out.push([u * u * Sx + 2 * t * u * wx + t * t * Ex, u * u * Sy + 2 * t * u * wy + t * t * Ey])
    }
    out.push([Ex, Ey])
    halfEnd = be === L[i] / 2
  }
  // 第一个圆弧的 S 可能与最后一个圆弧的 E 重合，交给 cleanup 合并
  return out
}

/** 去掉离前一点小于 eps 的点和严格共线的点 */
function cleanup(pts: Ring, eps: number): Ring {
  const out: Ring = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > eps) out.push(p)
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop()
  const n = out.length, keep: Ring = []
  for (let i = 0; i < n; i++) {
    const a = out[i === 0 ? n - 1 : i - 1], b = out[i], c = out[i + 1 === n ? 0 : i + 1]
    const x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1]
    const cr = x1 * y2 - y1 * x2, dt = x1 * x2 + y1 * y2
    if (!(dt > 0 && Math.abs(cr) <= 1e-9 * dt)) keep.push(b)
  }
  return keep.length >= 3 ? keep : out
}

// C 步：抽稀 ------------------------------------------------------------------------------------
/**
 * 线性贪心抽稀。顶点 b（介于上一个保留点 a 与下一点 c 之间）满足以下条件才删除：它和自 a 以来
 * 删掉的每个点都在弦 a-c 的 tol 以内，且 a、c 处的转角不超过 maxTurn。剩到 target 个点就停。
 */
function simplifyRing(pts: Ring, tol: number, maxTurn: number, target: number): Ring {
  const n = pts.length
  if (n <= target) return pts
  const tanMax = Math.tan(maxTurn) // 转角 > maxTurn  <=>  dot <= 0 或 |cross| > tanMax * dot
  const tol2 = tol * tol
  const out: Ring = [pts[0]]
  let removed = 0
  let a = 0, prevKept = n - 1 // prevKept：a 之前的保留点（用于判断 a 处的转角）
  let firstDropped = 1 // 当前删除段是 pts[firstDropped .. b-1]
  for (let b = 1; b < n; b++) {
    const c = b + 1 < n ? b + 1 : 0
    let drop = removed < n - target && b - firstDropped < 64
    if (drop) {
      const ax = pts[a][0], ay = pts[a][1], cx = pts[c][0], cy = pts[c][1]
      for (let k = firstDropped; k <= b && drop; k++) if (segDist2(ax, ay, cx, cy, pts[k][0], pts[k][1]) > tol2) drop = false
      if (drop) {
        const P = pts[prevKept], N = pts[c + 1 < n ? c + 1 : c + 1 - n]
        let x1 = ax - P[0], y1 = ay - P[1]
        const x2 = cx - ax, y2 = cy - ay
        let dt = x1 * x2 + y1 * y2
        if (dt <= 0 || Math.abs(x1 * y2 - y1 * x2) > tanMax * dt) drop = false
        else {
          x1 = N[0] - cx
          y1 = N[1] - cy
          dt = x2 * x1 + y2 * y1
          if (dt <= 0 || Math.abs(x2 * y1 - y2 * x1) > tanMax * dt) drop = false
        }
      }
    }
    if (drop) { removed++; continue }
    out.push(pts[b])
    prevKept = a
    a = b
    firstDropped = b + 1
  }
  return removed ? out : pts
}

// 校验 ------------------------------------------------------------------------------------------
function signedArea(pts: Ring): number {
  let s = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[i + 1 === n ? 0 : i + 1]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

function pointInRing(x: number, y: number, pts: Ring): boolean {
  let inside = false
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = ax + t * dx - px, ey = ay + t * dy - py
  return ex * ex + ey * ey
}

/**
 * 找出「两条不相邻的边相交或相距不到 tol」以及「相邻边折返成针尖」的环，返回其归属（tags）集合，
 * 并把出问题的位置记进 points[归属]。用均匀网格哈希，按边长逐段登记，耗时与总边数成线性。
 */
function segmentConflicts(rings: Ring[], tags: number[], tol: number, points: Pt[][]): Set<number> {
  let N = 0
  for (const r of rings) N += r.length
  const S = new Float64Array(4 * N), R = new Int32Array(N), I = new Int32Array(N), LEN = new Int32Array(N)
  let k = 0, total = 0
  const bad = new Set<number>()
  for (let r = 0; r < rings.length; r++) {
    const pts = rings[r], n = pts.length
    for (let i = 0; i < n; i++, k++) {
      const a = pts[i], b = pts[i + 1 === n ? 0 : i + 1]
      S[4 * k] = a[0]
      S[4 * k + 1] = a[1]
      S[4 * k + 2] = b[0]
      S[4 * k + 3] = b[1]
      R[k] = r
      I[k] = i
      LEN[k] = n
      total += Math.hypot(b[0] - a[0], b[1] - a[1])
      // 针尖：相邻两条边几乎原路折返（转角大于约 179.5°）
      const c = pts[i + 2 >= n ? i + 2 - n : i + 2]
      const x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1]
      const dt = x1 * x2 + y1 * y2
      if (dt < 0 && Math.abs(x1 * y2 - y1 * x2) <= 0.0087 * -dt) {
        bad.add(tags[r])
        if (points[tags[r]].length < 64) points[tags[r]].push(b)
      }
    }
  }
  if (!N) return bad
  const g = Math.max(4 * total / N, 1e-12), d2 = tol * tol
  const grid = new Map<number, number[]>()
  const keys: number[] = []
  for (let s = 0; s < N; s++) {
    const ax = S[4 * s], ay = S[4 * s + 1], bx = S[4 * s + 2], by = S[4 * s + 3]
    const minx = Math.min(ax, bx) - tol, maxx = Math.max(ax, bx) + tol, miny = Math.min(ay, by) - tol, maxy = Math.max(ay, by) + tol
    // 逐段（每段不长于 g）登记这条边经过的网格
    keys.length = 0
    const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / g))
    for (let q = 0; q < pieces; q++) {
      const t0 = q / pieces, t1 = (q + 1) / pieces
      const px = ax + (bx - ax) * t0, py = ay + (by - ay) * t0, qx = ax + (bx - ax) * t1, qy = ay + (by - ay) * t1
      const x0 = Math.floor((Math.min(px, qx) - tol) / g), x1 = Math.floor((Math.max(px, qx) + tol) / g)
      const y0 = Math.floor((Math.min(py, qy) - tol) / g), y1 = Math.floor((Math.max(py, qy) + tol) / g)
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const key = gx * 1048576 + gy
        if (!keys.includes(key)) keys.push(key)
      }
    }
    for (const key of keys) {
      let list = grid.get(key)
      if (!list) { list = []; grid.set(key, list) }
      for (let li = 0; li < list.length; li++) {
        const t = list[li]
        if (t === s) continue
        if (R[t] === R[s]) {
          const di = I[t] > I[s] ? I[t] - I[s] : I[s] - I[t]
          if (di === 1 || di === LEN[s] - 1) continue
        }
        const cx = S[4 * t], cy = S[4 * t + 1], dx = S[4 * t + 2], dy = S[4 * t + 3]
        if (Math.max(cx, dx) < minx || Math.min(cx, dx) > maxx || Math.max(cy, dy) < miny || Math.min(cy, dy) > maxy) continue
        const o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
        const o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
        const crosses = ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
        if (crosses || segDist2(ax, ay, bx, by, cx, cy) <= d2 || segDist2(ax, ay, bx, by, dx, dy) <= d2 ||
          segDist2(cx, cy, dx, dy, ax, ay) <= d2 || segDist2(cx, cy, dx, dy, bx, by) <= d2) {
          bad.add(tags[R[s]])
          bad.add(tags[R[t]])
          const ps = points[tags[R[s]]], pt = points[tags[R[t]]]
          if (ps.length < 64) ps.push([(ax + bx) / 2, (ay + by) / 2])
          if (pt.length < 64) pt.push([(cx + dx) / 2, (cy + dy) / 2])
        }
      }
      list.push(s)
    }
  }
  return bad
}

/** 校验一个多边形；失败时尽量给出出问题的位置（可能为空） */
function polygonCheck(rings: Ring[], originalRings: Ring[], cell: number): Check {
  const fail: Check = { ok: false, points: [] }
  for (let r = 0; r < rings.length; r++) {
    const pts = rings[r]
    if (pts.length < 3) return fail
    for (const p of pts) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return fail
    const ratio = signedArea(pts) / signedArea(originalRings[r])
    if (!(ratio > 0.5 && ratio < 2)) return fail // 同时挡住方向翻转与塌缩
  }
  const points: Pt[][] = rings.map(() => [])
  if (segmentConflicts(rings, rings.map((_, i) => i), 1e-6 * cell, points).size) return { ok: false, points: points.flat() }
  // 已排除相交与接触，用每个洞的首点判断包含关系即可
  for (let r = 1; r < rings.length; r++) {
    const [x, y] = rings[r][0]
    if (!pointInRing(x, y, rings[0])) return fail
    for (let s = 1; s < rings.length; s++) if (s !== r && pointInRing(x, y, rings[s])) return fail
  }
  return { ok: true, points: [] }
}

/** 互相接触/相交、或落在另一部件实心区域内的多部件，连同冲突位置 */
function multiConflicts(polysLocal: Ring[][], cell: number): { bad: Set<number>; points: Pt[][] } {
  const rings: Ring[] = [], tags: number[] = []
  polysLocal.forEach((rs, pi) => rs.forEach(r => { rings.push(r); tags.push(pi) }))
  const points: Pt[][] = polysLocal.map(() => [])
  const bad = segmentConflicts(rings, tags, 1e-6 * cell, points)
  for (let i = 0; i < polysLocal.length; i++) for (let j = 0; j < polysLocal.length; j++) {
    if (i === j) continue
    const [x, y] = polysLocal[j][0][0]
    if (pointInRing(x, y, polysLocal[i][0]) && !polysLocal[i].slice(1).some(h => pointInRing(x, y, h))) {
      bad.add(i)
      bad.add(j)
    }
  }
  return { bad, points }
}

function bboxOf(polys: Position[][][]): BBox {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const poly of polys) for (const ring of poly) for (const p of ring) {
    if (p[0] < a) a = p[0]
    if (p[1] < b) b = p[1]
    if (p[0] > c) c = p[0]
    if (p[1] > d) d = p[1]
  }
  return [a, b, c, d]
}
