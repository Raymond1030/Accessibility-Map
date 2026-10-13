import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { buildExportCollection } from './export'
import type { PolyFeature } from './geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

describe('buildExportCollection', () => {
  it('打包成 FeatureCollection', () => {
    const fc = buildExportCollection([{ minutes: 30, feature: shape }])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1)
  })

  it('把档位写进 properties', () => {
    const fc = buildExportCollection([{ minutes: 30, feature: shape }])
    expect(fc.features[0].properties?.minutes).toBe(30)
  })

  it('分别设置时写入每个起点的时间', () => {
    const fc = buildExportCollection([{
      minutesByOrigin: { a: 15, b: 45 },
      feature: shape,
    }])
    expect(fc.features[0].properties?.minutes).toBeUndefined()
    expect(fc.features[0].properties?.minutesByOrigin).toEqual({ a: 15, b: 45 })
  })

  it('标注坐标系为 WGS-84 标准坐标', () => {
    const fc = buildExportCollection([{ minutes: 30, feature: shape }])
    expect(fc.features[0].properties?.crs).toBe('WGS-84')
  })

  it('空输入得到空集合', () => {
    expect(buildExportCollection([]).features).toHaveLength(0)
  })
})
