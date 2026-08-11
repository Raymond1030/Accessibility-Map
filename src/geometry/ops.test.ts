import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { intersectAll, unionAll, differenceFrom, normalize } from './ops'

/** 生成一个以 (x, y) 为左下角、边长 size 的正方形 */
function square(x: number, y: number, size = 1) {
  return polygon([[
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ]])
}

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
})
