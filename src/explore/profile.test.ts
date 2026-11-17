vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
import { beforeEach, expect, it, vi } from 'vitest'
import { buildProfile, categoryScore, profileScore, comparePois } from './profile'
import { defaultWeights, type CategoryResult, type ExploreQuery, type LifeProfile, type Poi } from './types'
import { discover, searchCategory } from './poi'
import { queryRoute } from './requests'
vi.mock('./poi', () => ({ discover: vi.fn(), searchCategory: vi.fn() }))
vi.mock('./requests', async importOriginal => ({ ...await importOriginal<typeof import('./requests')>(), queryRoute: vi.fn() }))
const q: ExploreQuery = { center: { name: '中心', lngLat: [114, 22.5] }, city: '深圳', mode: 'walking', minutes: 15 }
const poi: Poi = { ...q.center, id: 'p', category: 'park', city: '深圳', address: '' }
const route = { seconds: 300, meters: 300, instructions: [], paths: [], fetchedAt: 1 }
const result: CategoryResult = { category: 'park', status: 'ok', places: [{ poi, route }, { poi: { ...poi, id: 'b' }, route: { ...route, seconds: 600 } }], checked: 2, truncated: false }
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(discover).mockResolvedValue({ geometry: null, nearbyTransit: true })
  vi.mocked(searchCategory).mockResolvedValue({ pois: [poi], truncated: false }); vi.mocked(queryRoute).mockResolvedValue(route)
})
it('scores quantity and shortest travel time equally and caps quantity at three', () => {
  expect(categoryScore(result, 15)).toBeCloseTo(66.6667)
  expect(categoryScore({ ...result, places: Array(5).fill(result.places[0]) }, 15)).toBeCloseTo(83.3333)
  expect(categoryScore({ ...result, places: [] }, 15)).toBe(0)
})
it('requires all weighted categories and does not score errors or zero weights', () => {
  const p: LifeProfile = { query: q, geometry: null, nearbyTransit: false, categories: { park: result } }
  const weights = Object.fromEntries(Object.keys(defaultWeights()).map(k => [k, 0])) as ReturnType<typeof defaultWeights>
  expect(profileScore(p, weights)).toBeNull(); weights.park = 4
  expect(profileScore(p, weights)).toBeCloseTo(66.6667); weights.mall = 1
  expect(profileScore(p, weights)).toBeNull()
  p.categories.mall = { ...result, category: 'mall', places: [], status: 'error' }; expect(profileScore(p, weights)).toBeNull()
  p.categories.mall.status = 'ok'; expect(profileScore(p, weights)).toBeCloseTo(53.3333)
})
it('limits verification to five, and uses exact seconds at the boundary', async () => {
  vi.mocked(searchCategory).mockResolvedValue({ pois: Array.from({ length: 9 }, (_, i) => ({ ...poi, id: String(i) })), truncated: true })
  vi.mocked(queryRoute).mockResolvedValueOnce({ ...route, seconds: 900 }).mockResolvedValueOnce({ ...route, seconds: 901 }).mockResolvedValueOnce(null)
  const p = await buildProfile(q, ['park'])
  expect(queryRoute).toHaveBeenCalledTimes(5); expect(p.categories.park?.places).toHaveLength(3)
  expect(p.categories.park?.truncated).toBe(true)
})
it('keeps successful places but suppresses score after a partial failure', async () => {
  vi.mocked(searchCategory).mockResolvedValue({ pois: [poi, { ...poi, id: 'b' }], truncated: false })
  vi.mocked(queryRoute).mockRejectedValueOnce(new Error('network'))
  const p = await buildProfile(q, ['park']); expect(p.categories.park?.places).toHaveLength(1)
  expect(categoryScore(p.categories.park, 15)).toBeNull()
})
it('search failures differ from a completed empty category', async () => {
  vi.mocked(searchCategory).mockRejectedValueOnce(new Error('denied'))
  expect((await buildProfile(q, ['park'])).categories.park?.status).toBe('error')
  vi.mocked(searchCategory).mockResolvedValueOnce({ pois: [], truncated: false })
  expect((await buildProfile(q, ['park'])).categories.park?.status).toBe('ok')
})
it('compares POI identities and refuses partial comparisons', () => {
  const after = { ...result, places: [result.places[1], { poi: { ...poi, id: 'new' }, route }] }
  const d = comparePois(result, after)!
  expect(d.common.map(p => p.poi.id)).toEqual(['b']); expect(d.added.map(p => p.poi.id)).toEqual(['new']); expect(d.lost.map(p => p.poi.id)).toEqual(['p'])
  expect(comparePois(result, { ...after, status: 'error' })).toBeNull()
})
