import { describe, it, expect } from 'vitest'
import { kinks } from '@turf/turf'
import { boundsToPolygons, boundsToNormalizedFeature } from './transform'
import fixture from './fixtures/arrival-range.json'

describe('boundsToPolygons', () => {
  it('把每条路径转成一个 Polygon', () => {
    const polys = boundsToPolygons(fixture.bounds)
    expect(polys).toHaveLength(3)
  })

  it('闭合环——高德不闭合，GeoJSON 必须闭合', () => {
    const polys = boundsToPolygons(fixture.bounds)
    const ring = polys[0].geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('丢弃点数不足以成面的路径', () => {
    const polys = boundsToPolygons([[{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }]])
    expect(polys).toHaveLength(0)
  })

  it('空 bounds 得到空数组（该点无公交覆盖）', () => {
    expect(boundsToPolygons([])).toHaveLength(0)
  })
})

describe('boundsToNormalizedFeature', () => {
  it('把重叠的分块并成无自交的要素', () => {
    const f = boundsToNormalizedFeature(fixture.bounds)
    expect(f).not.toBeNull()
    expect(kinks(f!).features).toHaveLength(0)
  })

  it('保留不连通的远处分块', () => {
    const f = boundsToNormalizedFeature(fixture.bounds)
    expect(f!.geometry.type).toBe('MultiPolygon')
  })

  it('空 bounds 返回 null', () => {
    expect(boundsToNormalizedFeature([])).toBeNull()
  })
})
