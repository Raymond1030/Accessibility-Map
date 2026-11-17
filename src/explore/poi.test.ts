import { beforeEach, expect, it, vi } from 'vitest'
import { polygon } from '@turf/turf'
import { discover, filterPois, parsePoiPage, searchCategory } from './poi'
import { loadAmap } from '../amap/loader'
import { createMapboxProvider } from '../providers/mapbox'
import type { ExploreQuery, Poi } from './types'
import { requests } from './requests'
vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
vi.mock('../providers/mapbox', () => ({ createMapboxProvider: vi.fn() }))
const q: ExploreQuery = { center: { name: '起点', lngLat: [114, 22.5] }, city: '深圳', mode: 'walking', minutes: 15 }
beforeEach(() => vi.restoreAllMocks())
it('normalizes SDK coordinates and rejects invalid entries', () => {
  const page = parsePoiPage('complete', { poiList: { count: 3, pois: [{ id: 'a', name: '店', location: { lng: 114, lat: 22.5 } }, { name: 'bad' }, { name: '', location: { lng: 114, lat: 22.5 } }] } }, 'mall', '深圳')
  expect(page.pois).toHaveLength(1); expect(page.pois[0].lngLat[0]).not.toBe(114); expect(page.pois[0].city).toBe('深圳'); expect(page.count).toBe(3)
})
it('separates no_data from malformed successful responses', () => {
  expect(parsePoiPage('no_data', {}, 'mall', '深圳').pois).toEqual([])
  expect(() => parsePoiPage('complete', {}, 'mall', '深圳')).toThrow()
  expect(() => parsePoiPage('error', 'DENIED', 'mall', '深圳')).toThrow('DENIED')
})
it('filters holes, exterior points, and duplicate identities', () => {
  const geometry = polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]])
  const p = (id: string, lngLat: [number, number]): Poi => ({ id, name: id, lngLat, city: '', address: '', category: 'mall' })
  expect(filterPois([p('a', [1, 1]), p('a', [2, 2]), p('hole', [5, 5]), p('out', [11, 11])], { geometry, nearbyTransit: false }, q).map(p => p.id)).toEqual(['a'])
})
it('public transport avoids the retired contour provider and other modes dispatch correctly', async () => {
  expect(await discover({ ...q, mode: 'transit' })).toEqual({ geometry: null, nearbyTransit: true }); expect(createMapboxProvider).not.toHaveBeenCalled()
  const signal = new AbortController().signal
  const pooled = vi.spyOn(requests, 'run').mockImplementation(async (_key, work) => work(signal))
  const fetch = vi.fn().mockResolvedValue(polygon([[[0, 0], [1, 0], [0, 1], [0, 0]]]))
  vi.mocked(createMapboxProvider).mockReturnValue({ id: 'test', supportedModes: [], fetch })
  for (const mode of ['walking', 'cycling', 'driving'] as const) await discover({ ...q, mode })
  expect(fetch.mock.calls.map(c => c[0].mode)).toEqual(['walking', 'cycling', 'driving'])
  expect(fetch.mock.calls.every(c => c[0].signal === signal)).toBe(true)
  expect(pooled).toHaveBeenCalledTimes(3)
})
it('caps paging at 3 × 20 and reports truncation', async () => {
  vi.spyOn(requests, 'run').mockImplementation(async (_key, work) => work())
  const options: any[] = []
  class PlaceSearch {
    constructor(o: any) { options.push(o) }
    searchNearBy(_keyword: string, _center: unknown, _radius: number, cb: (status: string, result: unknown) => void) {
      cb('complete', { poiList: { count: 90, pois: [{ id: 'same', name: '公园', location: { lng: 114, lat: 22.5 } }] } })
    }
  }
  vi.mocked(loadAmap).mockResolvedValue({ PlaceSearch })
  const result = await searchCategory({ ...q, mode: 'transit' }, { geometry: null, nearbyTransit: true }, 'park')
  expect(options.map(o => [o.pageIndex, o.pageSize])).toEqual([[1, 20], [2, 20], [3, 20]])
  expect(result.pois).toHaveLength(1); expect(result.truncated).toBe(true)
})
