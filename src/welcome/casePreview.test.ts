import { describe, expect, it, vi } from 'vitest'
import { polygon } from '@turf/turf'
import { loadCasePreview, type PreviewServices } from './casePreview'
import type { Route } from '../commute/types'
vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))

const shape = polygon([[[113.9, 22.5], [114, 22.5], [114, 22.6], [113.9, 22.6], [113.9, 22.5]]])
const route = (seconds: number): Route => ({ seconds, meters: 500, paths: [[[113.94, 22.53], [113.95, 22.54]]], instructions: [], fetchedAt: 123 })
function services(): PreviewServices {
  return {
    place: async name => ({ name, lngLat: [113.94, 22.53] }),
    range: async () => shape,
    route: async () => route(421),
    pois: async (_q, _d, category) => ({ pois: [{ id: category, name: `真实${category}`, lngLat: [113.95, 22.54], city: '深圳', address: '', category }], truncated: false }),
    rangeSource: '测试路网',
  }
}

describe('welcome cards use computed data', () => {
  it('uses returned seconds and route geometry instead of preset times and lines', async () => {
    const deps = services()
    deps.route = vi.fn().mockResolvedValueOnce(route(601)).mockResolvedValueOnce(route(1261))
    const result = await loadCasePreview('commute', new AbortController().signal, deps)
    expect(result.readout.map(item => item.text).join(' ')).toMatch(/11 分.*22 分/)
    expect(result.data.features.flatMap(f => f.geometry.type === 'LineString' ? [f.geometry.coordinates] : [])).toEqual([route(601).paths[0], route(1261).paths[0]])
    expect(result.data.features.some(f => f.geometry.type === 'Polygon')).toBe(false)
  })
  it('preserves a successful commute when the other query fails, without inventing a duration', async () => {
    const deps = services()
    deps.route = vi.fn().mockResolvedValueOnce(route(601)).mockRejectedValueOnce(new Error('服务不可用'))
    const result = await loadCasePreview('commute', new AbortController().signal, deps)
    expect(result.readout.map(item => item.text).join(' ')).toMatch(/11 分.*查询失败/)
    expect(result.data.features).toHaveLength(1)
    expect(result.incomplete).toBe(true)
  })
  it('does not fabricate a common region for disjoint calculated ranges', async () => {
    const deps = services()
    deps.range = vi.fn().mockResolvedValueOnce(shape).mockResolvedValueOnce(polygon([[[115, 22], [116, 22], [116, 23], [115, 23], [115, 22]]]))
    const result = await loadCasePreview('isochrone', new AbortController().signal, deps)
    expect(result.data.features).toHaveLength(2)
    expect(result.readout.map(item => item.text).join('')).toContain('暂无交集')
  })
  it('keeps only actual POIs with a successful route within the time budget', async () => {
    const deps = services()
    deps.route = vi.fn().mockResolvedValueOnce(route(900)).mockResolvedValueOnce(route(901)).mockResolvedValueOnce(null)
    const result = await loadCasePreview('explore', new AbortController().signal, deps)
    expect(result.pins.filter(p => p.text.includes('真实'))).toHaveLength(1)
    expect(result.pins.find(p => p.text.includes('真实'))?.text).toContain('15 分')
    expect(result.data.features.filter(f => f.geometry.type === 'LineString')).toHaveLength(1)
  })
  it('propagates missing range data and cancellation instead of returning a decorative polygon', async () => {
    const deps = services()
    deps.range = async () => null
    await expect(loadCasePreview('isochrone', new AbortController().signal, deps)).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(loadCasePreview('commute', controller.signal, deps)).rejects.toThrow()
  })
})
