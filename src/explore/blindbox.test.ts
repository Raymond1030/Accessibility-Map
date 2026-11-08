vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
import { beforeEach, expect, it, vi } from 'vitest'
import { drawPlaces, shuffled } from './blindbox'
import { discover, searchCategory } from './poi'
import { queryRoute } from './requests'
import type { ExploreQuery, Poi } from './types'
vi.mock('./poi', () => ({ discover: vi.fn(), searchCategory: vi.fn() }))
vi.mock('./requests', async importOriginal => ({ ...await importOriginal<typeof import('./requests')>(), queryRoute: vi.fn() }))
const q: ExploreQuery = { center: { name: '中心', lngLat: [114, 22.5] }, city: '深圳', mode: 'transit', minutes: 30 }
const poi = (id: string): Poi => ({ ...q.center, id, category: 'park', city: '深圳', address: '' })
const route = { seconds: 1800, meters: 1000, paths: [], instructions: [], fetchedAt: 1 }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(discover).mockResolvedValue({ geometry: null, nearbyTransit: true }); vi.mocked(queryRoute).mockResolvedValue(route) })
it('only includes checked routes and de-duplicates categories and exclusions', async () => {
  vi.mocked(searchCategory).mockResolvedValue({ pois: [poi('a'), poi('b'), poi('c'), poi('d')], truncated: false })
  const r = await drawPlaces(q, ['park', 'museum'], new Set(['a']))
  expect(r.places.map(p => p.poi.id).sort()).toEqual(['b', 'c', 'd']); expect(queryRoute).toHaveBeenCalledTimes(3)
})
it('never accepts over-limit, missing, or failed routes, and caps checks at twelve', async () => {
  vi.mocked(searchCategory).mockResolvedValue({ pois: Array.from({ length: 30 }, (_, i) => poi(String(i))), truncated: true })
  vi.mocked(queryRoute).mockResolvedValue({ ...route, seconds: 1801 }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('bad'))
  const r = await drawPlaces(q, ['park'], new Set())
  expect(r.places).toHaveLength(0); expect(r.checked).toBe(12); expect(r.errors).toHaveLength(1); expect(r.exhausted).toBe(false)
})
it('returns fewer than three instead of repeating destinations', async () => {
  vi.mocked(searchCategory).mockResolvedValue({ pois: [poi('a')], truncated: false })
  const r = await drawPlaces(q, ['park'], new Set()); expect(r.places).toHaveLength(1); expect(r.exhausted).toBe(true)
})
it('shuffle is injectable and preserves the input', () => {
  const input = [1, 2, 3]; expect(shuffled(input, () => 0)).toEqual([2, 3, 1]); expect(input).toEqual([1, 2, 3])
})
