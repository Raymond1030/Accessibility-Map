import { describe, it, expect } from 'vitest'
import { kinks } from '@turf/turf'
import {
  boundsToPolygons, boundsToNormalizedFeature, interpretArrivalRangeResult,
} from './transform'
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

describe('interpretArrivalRangeResult', () => {
  it('status 为 complete 且有数据时成功', () => {
    const r = interpretArrivalRangeResult('complete', {
      bounds: fixture.bounds, info: 'OK', infocode: '10000',
    })
    expect(r).toEqual({ ok: true, bounds: fixture.bounds })
  })

  it('status 为 no_data 但 infocode 是 10000 且有数据时，仍然成功', () => {
    // 这是线上实测到的真实响应形状：高德有数据时也会返回 no_data。
    // 只认 complete 会把正常成功当失败丢掉。
    const r = interpretArrivalRangeResult('no_data', {
      bounds: fixture.bounds, info: 'OK', infocode: '10000',
    })
    expect(r).toEqual({ ok: true, bounds: fixture.bounds })
  })

  it('no_data 且 bounds 真的为空时，成功但无覆盖', () => {
    const r = interpretArrivalRangeResult('no_data', {
      bounds: [], info: 'OK', infocode: '10000',
    })
    expect(r).toEqual({ ok: true, bounds: [] })
  })

  it('缺少 bounds 字段时按无覆盖处理，而不是报错', () => {
    const r = interpretArrivalRangeResult('no_data', { info: 'OK', infocode: '10000' })
    expect(r).toEqual({ ok: true, bounds: [] })
  })

  it('result 是错误码字符串时失败，并透出该码', () => {
    const r = interpretArrivalRangeResult('error', 'INVALID_USER_DOMAIN')
    expect(r).toEqual({ ok: false, error: 'INVALID_USER_DOMAIN' })
  })

  it('infocode 非 10000 时失败，用 info 作错误信息', () => {
    const r = interpretArrivalRangeResult('complete', {
      info: 'DAILY_QUERY_OVER_LIMIT', infocode: '10003',
    })
    expect(r).toEqual({ ok: false, error: 'DAILY_QUERY_OVER_LIMIT' })
  })

  it('status 为 error 时失败', () => {
    const r = interpretArrivalRangeResult('error', { info: 'ENGINE_RESPONSE_DATA_ERROR' })
    expect(r).toEqual({ ok: false, error: 'ENGINE_RESPONSE_DATA_ERROR' })
  })

  it('result 为 null 时失败而不是崩溃', () => {
    const r = interpretArrivalRangeResult('error', null)
    expect(r).toEqual({ ok: false, error: 'error' })
  })
})
