import { beforeEach, expect, it, vi } from 'vitest'
import { drawKey, useExplore } from './store'
import { buildProfile } from './profile'
import { drawPlaces } from './blindbox'
import { defaultWeights, type ExploreQuery, type LifeProfile, type ReachablePoi } from './types'
vi.mock('./profile', () => ({ buildProfile: vi.fn() }))
vi.mock('./blindbox', () => ({ drawPlaces: vi.fn() }))
const center = { name: '起点', lngLat: [114, 22.5] as [number, number] }
const q: ExploreQuery = { center, city: '深圳', mode: 'transit', minutes: 30 }
const p: ReachablePoi = { poi: { ...center, id: 'p', category: 'park', city: '深圳', address: '' }, route: { seconds: 60, meters: 40, instructions: [], paths: [], fetchedAt: 1 } }
beforeEach(() => {
  vi.clearAllMocks(); useExplore.getState().setCenter(center, '深圳'); useExplore.getState().setView('profile')
  useExplore.setState({ weights: defaultWeights(), favorites: [], rejected: [], seen: {}, profileSettings: { mode: 'walking', minutes: 15 }, blindSettings: { mode: 'transit', minutes: 30 }, interests: ['park'] })
})
it('ignores late profile results after an origin edit', async () => {
  let finish!: (p: LifeProfile) => void
  vi.mocked(buildProfile).mockImplementation(() => new Promise(r => { finish = r }))
  const pending = useExplore.getState().evaluate(); useExplore.getState().setCenter({ ...center, name: '新地点' })
  finish({ query: q, categories: {}, geometry: null, nearbyTransit: true }); await pending
  expect(useExplore.getState().profile).toBeNull(); expect(useExplore.getState().busy).toBe(false)
})
it('invalidates range and routes when time or mode changes', () => {
  useExplore.setState({ selected: p, profile: { query: q, categories: {}, geometry: null, nearbyTransit: true } })
  useExplore.getState().setSettings({ minutes: 20 }); expect(useExplore.getState().profile).toBeNull(); expect(useExplore.getState().selected).toBeNull()
})
it('keeps input when switching views but cancels outstanding work', () => {
  useExplore.getState().setSettings({ minutes: 20 }); useExplore.getState().setView('blindbox')
  expect(useExplore.getState().center).toEqual(center); expect(useExplore.getState().profileSettings.minutes).toBe(20); expect(useExplore.getState().blindSettings.minutes).toBe(30)
})
it('remembers shown places only for the same draw conditions, with favorites and rejections excluded', async () => {
  useExplore.getState().setView('blindbox'); vi.mocked(drawPlaces).mockResolvedValue({ places: [p], errors: [], exhausted: true, checked: 1 })
  await useExplore.getState().evaluate(); await useExplore.getState().evaluate()
  expect(vi.mocked(drawPlaces).mock.calls[1][2].has('p')).toBe(true)
  useExplore.getState().favorite(p); useExplore.getState().reject('x'); useExplore.getState().resetDraw(); await useExplore.getState().evaluate()
  expect(vi.mocked(drawPlaces).mock.calls[2][2]).toEqual(new Set(['p', 'x']))
  expect(drawKey(q, ['park', 'mall'])).toBe(drawKey(q, ['mall', 'park']))
})
