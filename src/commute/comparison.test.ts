vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
import { beforeEach, expect, it, vi } from 'vitest'
import { rentComparison, roundTrip, weeklyTotal, type RoundTrip, type Visit } from './comparison'
import { queryRoute } from '../explore/requests'
vi.mock('../explore/requests', async importOriginal => ({ ...await importOriginal<typeof import('../explore/requests')>(), queryRoute: vi.fn() }))
const route = (minutes: number) => ({ seconds: minutes * 60, meters: 1000, paths: [], instructions: [], fetchedAt: 1 })
const trip = (out: number, back: number): RoundTrip => ({ out: route(out), back: route(back), errors: [] })
const visit: Visit = { id: 'v', place: { name: '公司', lngLat: [2, 2] }, city: '乙城', mode: 'transit', weekly: 5 }
beforeEach(() => vi.clearAllMocks())
it('queries opposite directions and swaps both city arguments', async () => {
  vi.mocked(queryRoute).mockResolvedValueOnce(route(40)).mockResolvedValueOnce(route(55))
  const r = await roundTrip({ name: '家', lngLat: [1, 1] }, '甲城', visit)
  expect(r.out?.seconds).toBe(2400); expect(r.back?.seconds).toBe(3300)
  expect(vi.mocked(queryRoute).mock.calls[1][0]).toMatchObject({ origin: [2, 2], destination: [1, 1], city: '乙城', destinationCity: '甲城' })
})
it('calculates monthly savings from independently queried return trips', () => {
  const r = rentComparison(3000, 3600, trip(40, 45), trip(20, 25), 22)
  expect(r.hours).toBeCloseTo(14.6667); expect(r.price).toBeCloseTo(40.9091)
  expect(rentComparison(3000, 3600, trip(40, 45), trip(20, 25), 11).hours).toBeCloseTo(7.3333)
})
it('handles missing rent, missing return, and equal travel time without infinity', () => {
  expect(rentComparison(null, 2000, trip(20, 30), trip(10, 10), 22).price).toBeNull()
  expect(rentComparison(1000, 2000, trip(20, 30), { out: route(10), back: null, errors: [] }, 22).hours).toBeNull()
  expect(rentComparison(1000, 2000, trip(20, 30), trip(30, 20), 22).price).toBeNull()
})
it('distinguishes the cost/time tradeoffs', () => {
  expect(rentComparison(3000, 2000, trip(40, 40), trip(20, 20), 22).verdict).toBe('更便宜，也更省时')
  expect(rentComparison(3000, 4000, trip(20, 20), trip(40, 40), 22).verdict).toBe('更贵，也更费时')
  expect(rentComparison(3000, 2000, trip(20, 20), trip(40, 40), 22).verdict).toBe('省下租金，多花时间')
})
it('weekly counts represent round trips and incomplete totals remain partial', () => {
  expect(weeklyTotal([visit], { v: trip(20, 40) })).toEqual({ seconds: 18000, missing: [], complete: true })
  expect(weeklyTotal([visit, { ...visit, id: 'missing' }], { v: trip(20, 40) }).complete).toBe(false)
  expect(weeklyTotal([{ ...visit, weekly: 0 }], {}).complete).toBe(true)
})
it('keeps the known direction in partial weekly totals and identifies the missing direction', () => {
  expect(weeklyTotal([visit], { v: { out: route(20), back: null, errors: ['timeout'] } }))
    .toEqual({ seconds: 6000, missing: ['公司（回程）'], complete: false })
  expect(weeklyTotal([{ ...visit, weekly: 2 }], { v: { out: null, back: route(40), errors: [] } }))
    .toEqual({ seconds: 4800, missing: ['公司（去程）'], complete: false })
})
