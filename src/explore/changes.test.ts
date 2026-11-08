import { expect, it, vi } from 'vitest'
vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
vi.mock('./requests', async original => ({ ...await original<typeof import('./requests')>(), queryRoute: vi.fn() }))
import { verifyChanges } from './changes'
import { queryRoute } from './requests'
import type { LifeProfile, ReachablePoi } from './types'
const place = (id: string): ReachablePoi => ({ poi: { id, name: id, city: '深圳', category: 'park', address: '', lngLat: [114, 22.5] }, route: { seconds: 100, meters: 100, paths: [], instructions: [], fetchedAt: 1 } })
const profile = (places: ReachablePoi[]): LifeProfile => ({ query: { center: { name: '家', lngLat: [114.1, 22.5] }, city: '深圳', mode: 'walking', minutes: 15 }, geometry: null, nearbyTransit: false, categories: { park: { category: 'park', status: 'ok', places, checked: places.length, truncated: true } } })
it('a POI absent from the other search sample can still be commonly reachable', async () => {
  vi.mocked(queryRoute).mockResolvedValue(place('x').route)
  const changes = await verifyChanges(profile([place('a')]), profile([place('b')]), ['park'])
  expect(changes.park?.common.map(p => p.poi.id)).toEqual(['a', 'b']); expect(changes.park?.lost).toEqual([]); expect(changes.park?.added).toEqual([])
})
it('only marks changes after cross-route verification and treats failures as unknown', async () => {
  vi.mocked(queryRoute).mockResolvedValueOnce({ ...place('x').route, seconds: 901 }).mockResolvedValueOnce(null)
  const changes = await verifyChanges(profile([place('a')]), profile([place('b')]), ['park'])
  expect(changes.park?.lost.map(p => p.poi.id)).toEqual(['a']); expect(changes.park?.added.map(p => p.poi.id)).toEqual(['b'])
  vi.mocked(queryRoute).mockRejectedValue(new Error('network'))
  const unknown = await verifyChanges(profile([place('a')]), profile([]), ['park'])
  expect(unknown.park?.lost).toEqual([]); expect(unknown.park?.error).toBe('network')
})
