import { describe, it, expect } from 'vitest'
import { area as geoArea, booleanValid, buffer, difference, featureCollection, intersect, kinks, polygon, transformTranslate, union } from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import { estimateGridCell, smoothIsochrone } from './smooth'
import { simplifyForOps, type PolyFeature } from './ops'

// 全部用深圳附近的坐标：平滑在局部平面坐标里做，纬度会影响 x 方向的缩放
const LNG0 = 113.9, LAT0 = 22.5
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320 / 110574

/** 网格坐标（单位：格）→ 经纬度 */
const toLngLat = (cell: number) => ([x, y]: number[]): Position => [LNG0 + x * cell, LAT0 + y * cell]
const poly = (rings: number[][][], cell: number, properties: Record<string, unknown> = {}): PolyFeature =>
  polygon(rings.map(r => r.map(toLngLat(cell))), properties) as PolyFeature

const ringsOf = (f: PolyFeature): Position[][] => f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat()
/** 局部平面坐标，单位为格（与平滑内部用的坐标系一致） */
const local = (f: PolyFeature, cell: number) => ringsOf(f).map(r => r.map(([lng, lat]) => [(lng - LNG0) * KX / cell, (lat - LAT0) / cell]))
const counts = (f: PolyFeature) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  return { polygons: polys.length, holes: polys.reduce((n, p) => n + p.length - 1, 0) }
}

function segDist(px: number, py: number, a: number[], b: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)
}
/** 双向最大偏差（格）：沿一条边界每 0.05 格取点，量到另一条边界的最近距离 */
function maxDeviation(a: PolyFeature, b: PolyFeature, cell: number) {
  const oneWay = (from: number[][][], to: number[][][]) => {
    let worst = 0
    for (const r of from) for (let i = 1; i < r.length; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]) / 0.05))
      for (let k = 0; k < n; k++) {
        const px = r[i - 1][0] + (r[i][0] - r[i - 1][0]) * k / n, py = r[i - 1][1] + (r[i][1] - r[i - 1][1]) * k / n
        let best = Infinity
        for (const s of to) for (let j = 1; j < s.length; j++) best = Math.min(best, segDist(px, py, s[j - 1], s[j]))
        worst = Math.max(worst, best)
      }
    }
    return worst
  }
  const la = local(a, cell), lb = local(b, cell)
  return Math.max(oneWay(la, lb), oneWay(lb, la))
}
/** 输出里最大的单点转角（度），在局部平面坐标里量 */
function maxTurnDeg(f: PolyFeature, cell: number) {
  let worst = 0
  for (const r of local(f, cell)) {
    const n = r.length - 1
    for (let i = 0; i < n; i++) {
      const p = r[(i - 1 + n) % n], q = r[i], s = r[(i + 1) % n]
      const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(s[1] - q[1], s[0] - q[0])
      let d = Math.abs(a2 - a1) * 180 / Math.PI
      if (d > 180) d = 360 - d
      worst = Math.max(worst, d)
    }
  }
  return worst
}
const area = (f: PolyFeature, cell: number) => local(f, cell).reduce((sum, r, i) => {
  let s = 0
  for (let k = 1; k < r.length; k++) s += r[k - 1][0] * r[k][1] - r[k][0] * r[k - 1][1]
  // 外环为正、洞为负（Polygon 内第一个环之后都是洞；这里只用于单个 Polygon）
  return sum + (i === 0 ? Math.abs(s / 2) : -Math.abs(s / 2))
}, 0)
function expectValid(f: PolyFeature) {
  expect(kinks(f).features).toHaveLength(0)
  expect(booleanValid(f)).toBe(true)
}

/** 斜边是 1:1 台阶的直角三角形：(0,0) → (n,0) → (n,n)，再一级级下到 (0,0) */
function stairTriangle(n: number, cell: number) {
  const ring = [[0, 0], [n, 0], [n, n]]
  for (let k = n; k >= 1; k--) ring.push([k - 1, k], [k - 1, k - 1])
  return poly([ring], cell, { contour: 45 })
}

/** 由栅格拼出网格等值线式的多边形：格子求并，再内缩 0.03 格（像 Mapbox 那样让只在角上相碰的块分开） */
function rasterPolygon(rows: string[], cell: number): PolyFeature | null {
  const squares: Feature<Polygon>[] = []
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '#') return
    const top = rows.length - y
    squares.push(poly([[[x, top - 1], [x + 1, top - 1], [x + 1, top], [x, top], [x, top - 1]]], cell) as Feature<Polygon>)
  }))
  const merged = squares.length > 1 ? union(featureCollection(squares)) : squares[0]
  if (!merged) return null
  return (buffer(merged, -0.03 * cell * 111320, { units: 'meters', steps: 2 }) as PolyFeature | undefined) ?? null
}

describe('smoothIsochrone：去掉网格台阶', () => {
  const cell = 0.003

  it('1:1 台阶被拉成一条直线，且不再有直角', () => {
    const raw = stairTriangle(12, cell)
    const out = smoothIsochrone(raw)
    expectValid(out)
    expect(maxTurnDeg(raw, cell)).toBe(90)
    expect(maxTurnDeg(out, cell)).toBeLessThanOrEqual(25)
    // 规则台阶各边中点共线：斜边中段（沿边每 0.1 格取点）都应落在 y = x + 0.5 这条中线上
    const ring = ringsOf(out)[0].map(([lng, lat]) => [(lng - LNG0) / cell, (lat - LAT0) / cell])
    const mid: number[][] = []
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1], [x1, y1] = ring[i]
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.1))
      for (let k = 0; k < n; k++) mid.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n])
    }
    const diagonal = mid.filter(([x, y]) => x >= 2 && x <= 10 && y > x - 0.5)
    expect(diagonal.length).toBeGreaterThan(50)
    for (const [x, y] of diagonal) expect(Math.abs(y - x - 0.5)).toBeLessThan(0.1)
  })

  it('偏差不超过约半格，面积几乎不变', () => {
    const raw = stairTriangle(12, cell)
    const out = smoothIsochrone(raw)
    expect(maxDeviation(raw, out, cell)).toBeLessThan(0.55)
    expect(Math.abs(area(out, cell) / area(raw, cell) - 1)).toBeLessThan(0.02)
  })

  it('保留 properties、id 与几何类型，不改动输入', () => {
    const raw = { ...stairTriangle(8, cell), id: 'iso-45' }
    const before = JSON.stringify(raw)
    const out = smoothIsochrone(raw)
    expect(JSON.stringify(raw)).toBe(before)
    expect(out.properties).toBe(raw.properties)
    expect(out.id).toBe('iso-45')
    expect(out.geometry.type).toBe('Polygon')
    expect(out.geometry).not.toEqual(raw.geometry)
  })

  it('同样的输入得到同样的输出', () => {
    const raw = stairTriangle(10, cell)
    expect(smoothIsochrone(raw).geometry).toEqual(smoothIsochrone(raw).geometry)
  })

  it('靠近外环的台阶状洞仍是洞，且仍在外环之内', () => {
    const raw = rasterPolygon([
      '############',
      '#....#######',
      '#....#######',
      '############',
      '############',
      '#######..###',
      '#######..###',
      '############',
    ], cell)!
    const out = smoothIsochrone(raw)
    expectValid(out)
    expect(counts(out)).toEqual(counts(raw))
    expect(counts(out).holes).toBe(2)
    expect(maxDeviation(raw, out, cell)).toBeLessThan(0.55)
  })

  it('多部件：只在角上相近的两块平滑后仍各自独立、互不重叠', () => {
    const raw = rasterPolygon([
      '####....',
      '####....',
      '####....',
      '....####',
      '....####',
      '....####',
    ], cell)!
    expect(raw.geometry.type).toBe('MultiPolygon')
    const out = smoothIsochrone(raw)
    expectValid(out)
    expect(out.geometry.type).toBe('MultiPolygon')
    expect(counts(out)).toEqual(counts(raw))
    const [a, b] = (out.geometry.type === 'MultiPolygon' ? out.geometry.coordinates : []).map(c => polygon(c))
    expect(intersect(featureCollection([a, b]))).toBeNull()
  })

  it('bbox 跟着新坐标重算', () => {
    const raw = { ...stairTriangle(6, cell), bbox: [0, 0, 0, 0] as [number, number, number, number] }
    const out = smoothIsochrone(raw)
    const ring = ringsOf(out)[0]
    expect(out.bbox).toEqual([
      Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])),
      Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1])),
    ])
  })
})

describe('smoothIsochrone：小范围的圈', () => {
  // 约 4×3 格的不规则小块，像 Mapbox 给出的 5 分钟步行圈：顶点不在网格线上，按格割角后
  // 面积会缩掉 8% 以上，要外扩约 0.1 格才补得回来
  const cell = 0.001
  const raw = poly([[[4, 3], [0.9, 2.6], [0, 0.5], [2, 0], [2.8, 0.6], [3.7, 0.7], [4.5, 2.5], [4.4, 2.9], [4, 3]]], cell, { contour: 5 })

  it('面积补得回来，偏差仍在半格左右', () => {
    const out = smoothIsochrone(raw, { maxCellDeg: 0.00125 })
    expectValid(out)
    expect(Math.abs(area(out, cell) / area(raw, cell) - 1)).toBeLessThan(0.02)
    expect(maxDeviation(raw, out, cell)).toBeLessThan(0.55)
  })
})

describe('smoothIsochrone 与集合运算前的简化', () => {
  it('平滑结果登记了自身精度：小范围直接参与运算，不会再被 10 米简化削出折角', () => {
    const raw = stairTriangle(12, 0.003)
    const out = smoothIsochrone(raw)
    expect(simplifyForOps(out)).toBe(out)
    expect(simplifyForOps(raw)).not.toBe(raw)
  })
})

describe('smoothIsochrone：不认识的输入原样返回', () => {
  it('非多边形几何', () => {
    const line = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } } as unknown as PolyFeature
    expect(smoothIsochrone(line)).toBe(line)
  })

  it('缺几何、空坐标、点数不足或坐标非有限数', () => {
    const cases = [
      { type: 'Feature', properties: {}, geometry: null },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, NaN], [0, 0]]] } },
    ] as unknown as PolyFeature[]
    for (const f of cases) expect(smoothIsochrone(f)).toBe(f)
  })
})

describe('smoothIsochrone：随机网格轮廓', () => {
  // 固定种子的线性同余发生器：每次跑的都是同一批形状
  let seed = 20261108
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  function randomRows(w: number, h: number) {
    const noise = Array.from({ length: h }, () => Array.from({ length: w }, rand))
    const at = (x: number, y: number) => {
      let s = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = noise[y + dy]?.[x + dx]
        if (v !== undefined) { s += v; n++ }
      }
      return s / n
    }
    const t = 0.45 + rand() * 0.1
    return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) =>
      x === 0 || y === 0 || x === w - 1 || y === h - 1 || at(x, y) <= t ? '.' : '#').join(''))
  }

  it('有效、拓扑不变、偏差约半格以内、面积基本不变，布尔运算照常可用', () => {
    let tested = 0
    for (let i = 0; i < 40; i++) {
      const cell = [0.001, 0.002, 0.003, 0.004][i % 4]
      const raw = rasterPolygon(randomRows(6 + Math.floor(rand() * 12), 6 + Math.floor(rand() * 12)), cell)
      if (!raw) continue
      tested++
      // 与 provider 一样给出网格上限，挡住把两格台阶误判成一格
      const out = smoothIsochrone(raw, { maxCellDeg: cell * 1.25 })
      expectValid(out)
      expect(counts(out)).toEqual(counts(raw))
      expect(maxDeviation(raw, out, cell)).toBeLessThan(0.55)
      // 只有几格大的碎块割角后缩得最多，面积补偿把它们拉回来
      expect(Math.abs(geoArea(out) / geoArea(raw) - 1)).toBeLessThan(0.06)
      // 像 compute.ts 那样先简化再做集合运算；另一方是错开 0.37 格的副本，模拟附近另一个起点的范围
      const a = simplifyForOps(out)
      const b = simplifyForOps(transformTranslate(out, cell * 111.32 * 0.37, 63, { units: 'kilometers' }))
      expect(() => {
        intersect(featureCollection([a, b]))
        union(featureCollection([a, b]))
        difference(featureCollection([a, b]))
      }).not.toThrow()
    }
    expect(tested).toBeGreaterThan(30)
  })
})

describe('estimateGridCell', () => {
  const ringsOfPoly = (f: PolyFeature) => [ringsOf(f)]

  it('台阶的格长就是最常见的单步跨度', () => {
    expect(estimateGridCell(ringsOfPoly(stairTriangle(12, 0.003)))).toBeCloseTo(0.003, 9)
    expect(estimateGridCell(ringsOfPoly(stairTriangle(12, 0.001)))).toBeCloseTo(0.001, 9)
  })

  it('证据不足时退回最细的 0.001°', () => {
    expect(estimateGridCell([[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]])).toBe(0.001)
  })

  it('上限挡住把两格台阶当成一格的高估', () => {
    // 每级台阶横走两格、竖走一格，再加几段两格长的边：两格跨度成了众数
    const ring = [[0, 0], [24, 0], [24, 12]]
    for (let k = 12; k >= 1; k--) ring.push([2 * k - 2, k], [2 * k - 2, k - 1])
    ring.push([0, 0])
    const rings = [ring.map(toLngLat(0.001))]
    rings[0].splice(1, 0, [LNG0 + 0.002, LAT0 - 0.002], [LNG0 + 0.004, LAT0 - 0.002], [LNG0 + 0.006, LAT0])
    expect(estimateGridCell([rings])).toBeCloseTo(0.002, 9)
    expect(estimateGridCell([rings], 0.00125)).toBeCloseTo(0.001, 9)
  })
})
