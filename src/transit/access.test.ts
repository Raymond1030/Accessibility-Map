import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { estimateAccess } from './access'
import type { PolyFeature } from '../geometry/ops'
import type { MetroStation } from './types'

/** 以 (114, 22.5) 为中心、边长 2r 度的正方形 */
function square(r: number): PolyFeature {
  const [cx, cy] = [114, 22.5]
  return polygon([[
    [cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx - r, cy - r],
  ]]) as PolyFeature
}

const STATIONS: MetroStation[] = [
  { id: 'near', name: '近站', lngLat: [114.005, 22.5] },
  { id: 'mid', name: '中站', lngLat: [114.015, 22.5] },
  { id: 'far', name: '远站', lngLat: [114.05, 22.5] },
]

describe('estimateAccess', () => {
  it('每个站取包含它的最小档', () => {
    const entries = estimateAccess(STATIONS, [
      { minutes: 5, feature: square(0.01) },
      { minutes: 10, feature: square(0.02) },
    ])
    expect(entries).toEqual([
      { stationId: 'near', accessMin: 5 },
      { stationId: 'mid', accessMin: 10 },
    ])
  })

  it('档位乱序传入也按从小到大匹配', () => {
    const entries = estimateAccess(STATIONS, [
      { minutes: 10, feature: square(0.02) },
      { minutes: 5, feature: square(0.01) },
    ])
    expect(entries.find((e) => e.stationId === 'near')?.accessMin).toBe(5)
  })

  it('无覆盖的档（feature 为 null）被跳过', () => {
    const entries = estimateAccess(STATIONS, [
      { minutes: 5, feature: null },
      { minutes: 10, feature: square(0.02) },
    ])
    expect(entries).toEqual([
      { stationId: 'near', accessMin: 10 },
      { stationId: 'mid', accessMin: 10 },
    ])
  })

  it('全部档位为 null 时没有进站点', () => {
    expect(estimateAccess(STATIONS, [{ minutes: 5, feature: null }])).toEqual([])
  })

  it('圈外的站不成为进站点', () => {
    const entries = estimateAccess(STATIONS, [{ minutes: 15, feature: square(0.03) }])
    expect(entries.some((e) => e.stationId === 'far')).toBe(false)
  })
})
