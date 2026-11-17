import { describe, it, expect } from 'vitest'
import { kinks, polygon, simplify } from '@turf/turf'
import { intersectAll, unionAll, differenceFrom, normalize, simplifyForOps, keepDetail, SIMPLIFY_TOLERANCE, type PolyFeature } from './ops'

/** 生成一个以 (x, y) 为左下角、边长 size 的正方形 */
function square(x: number, y: number, size = 1) {
  return polygon([[
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ]])
}

/** 正 n 边形近似的圆，半径 r 度 */
function circle(n: number, r: number, cx = 113.9, cy = 22.5) {
  const ring = Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)])
  ring.push([...ring[0]])
  return polygon([ring])
}

/** 单环多边形的顶点数 */
const vertices = (f: PolyFeature) => f.geometry.type === 'Polygon' ? f.geometry.coordinates[0].length : Number.NaN

describe('simplifyForOps', () => {
  it('没有登记精度的几何照旧按 SIMPLIFY_TOLERANCE 简化', () => {
    const c = circle(2000, 0.01)
    const s = simplifyForOps(c)
    expect(s.geometry).toEqual(simplify(c, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false }).geometry)
    expect(vertices(s)).toBeLessThan(100)
  })

  it('简化把细长尖角折成交叉的「蝴蝶结」时，退回未简化的几何', () => {
    // 方块右侧伸出一根细尖角，两侧最近处只隔 3 米。按 10 米简化时上侧的中间点被删掉，
    // 上侧直线从下侧那个点的下方穿过去——这正是真实 45 分钟驾车圈里出现过的折叠
    const spike = polygon([[
      [0, 0], [0.01, 0], [0.01, 0.0046], [0.0125, 0.00505], [0.013, 0.005],
      [0.0125, 0.00508], [0.01, 0.0052], [0.01, 0.01], [0, 0.01], [0, 0],
    ]])
    expect(kinks(simplify(spike, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false })).features.length).toBeGreaterThan(0)
    const s = simplifyForOps(spike)
    expect(kinks(s).features).toHaveLength(0)
    expect(s.geometry).toEqual(spike.geometry)
  })

  it('登记了精度、顶点不多的几何直接参与运算，不再抽稀', () => {
    const c = keepDetail(circle(200, 0.01), 2.5e-5)
    expect(simplifyForOps(c)).toBe(c)
  })

  it('登记了精度、顶点很多的几何按登记的精度抽稀，结果仍带着这个精度', () => {
    const c = keepDetail(circle(2000, 0.01), 2e-6)
    const s = simplifyForOps(c)
    expect(s.geometry).toEqual(simplify(c, { tolerance: 2e-6, highQuality: false }).geometry)
    expect(vertices(s)).toBeGreaterThan(vertices(simplifyForOps(circle(2000, 0.01))))
    expect(simplifyForOps(s)).toBe(s)
  })

  it('无效的精度不登记', () => {
    const c = keepDetail(circle(200, 0.01), Number.NaN)
    expect(simplifyForOps(c)).not.toBe(c)
  })
})

describe('intersectAll', () => {
  it('两个重叠正方形返回重叠区域', () => {
    const result = intersectAll([square(0, 0, 2), square(1, 1, 2)])
    expect(result).not.toBeNull()
  })

  it('完全不相交时返回 null（空交集是有效结论）', () => {
    const result = intersectAll([square(0, 0), square(10, 10)])
    expect(result).toBeNull()
  })

  it('单个输入时交集等于自身', () => {
    const only = square(0, 0)
    const result = intersectAll([only])
    expect(result).not.toBeNull()
    expect(result!.geometry).toEqual(only.geometry)
  })

  it('三个图形中只要有一个不相交，整体即为空', () => {
    const result = intersectAll([square(0, 0, 2), square(1, 1, 2), square(50, 50)])
    expect(result).toBeNull()
  })

  it('空数组返回 null', () => {
    expect(intersectAll([])).toBeNull()
  })
})

describe('unionAll', () => {
  it('两个分离的图形合成一个 MultiPolygon', () => {
    const result = unionAll([square(0, 0), square(10, 10)])
    expect(result).not.toBeNull()
    expect(result!.geometry.type).toBe('MultiPolygon')
  })

  it('空数组返回 null', () => {
    expect(unionAll([])).toBeNull()
  })
})

describe('differenceFrom', () => {
  it('减去不相交的图形后基准保持非空', () => {
    const result = differenceFrom(square(0, 0), [square(10, 10)])
    expect(result).not.toBeNull()
  })

  it('被完全覆盖时返回 null（差集为空是有效结论）', () => {
    const result = differenceFrom(square(1, 1), [square(0, 0, 5)])
    expect(result).toBeNull()
  })

  it('没有其他图形可减时返回基准自身', () => {
    const base = square(0, 0)
    const result = differenceFrom(base, [])
    expect(result).not.toBeNull()
  })
})

describe('normalize', () => {
  it('把一组相互重叠的多边形并成无自交的单一要素', () => {
    const result = normalize([square(0, 0, 2), square(1, 0, 2), square(2, 0, 2)])
    expect(result).not.toBeNull()
    expect(result!.geometry.type).toBe('Polygon')
  })

  it('保留不连通的部分为 MultiPolygon', () => {
    const result = normalize([square(0, 0), square(10, 10)])
    expect(result!.geometry.type).toBe('MultiPolygon')
  })

  it('空输入返回 null', () => {
    expect(normalize([])).toBeNull()
  })

  it('并集继承输入里最细的细节精度（地铁步行圈合并后仍保持圆滑）', () => {
    const merged = normalize([keepDetail(circle(200, 0.01), 2.5e-5), circle(200, 0.01, 113.91)])
    expect(merged).not.toBeNull()
    expect(simplifyForOps(merged!)).toBe(merged)
    const plain = normalize([circle(200, 0.01), circle(200, 0.01, 113.91)])
    expect(simplifyForOps(plain!)).not.toBe(plain)
  })
})
