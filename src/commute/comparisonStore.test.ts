vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
import { beforeEach, expect, it, vi } from 'vitest'
import { useCommute } from './store'
import { useComparison, selectedPair } from './comparisonStore'
import { roundTrip } from './comparison'
vi.mock('./comparison', () => ({ roundTrip: vi.fn() }))
const home = (id: string) => ({ id, name: id, lngLat: [114, 22.5] as [number, number], rent: 1000 })
const trip = { out: null, back: null, errors: [] }
beforeEach(() => {
  vi.resetAllMocks(); useComparison.getState().invalidate()
  useComparison.setState({ baseId: null, targetId: null, visits: [] })
  useCommute.setState({ homes: [home('a'), home('b')], workplace: home('公司'), city: '深圳', destinationCity: '深圳', mode: 'transit' })
})
it('chooses a distinct target when the baseline changes', () => {
  expect(selectedPair().base?.id).toBe('a'); expect(selectedPair().target?.id).toBe('b')
  useComparison.getState().setPair('b', 'b'); expect(selectedPair().target?.id).toBe('a')
})
it('deleted homes cannot receive late route results', async () => {
  const callbacks: Array<(value: typeof trip) => void> = []
  vi.mocked(roundTrip).mockImplementation(() => new Promise(r => callbacks.push(r)))
  const pending = useComparison.getState().evaluate(false)
  useCommute.getState().removeHome('b'); callbacks.forEach(r => r(trip)); await pending
  expect(useComparison.getState().trips).toEqual({}); expect(useComparison.getState().busy).toBe(false)
})
it('rent/day changes reuse routes, but city/mode changes invalidate them', () => {
  useComparison.setState({ trips: { a: { work: trip } } })
  useCommute.getState().setRent('a', 2000); useComparison.getState().setDays(10)
  expect(useComparison.getState().trips.a).toBeDefined()
  useCommute.setState({ mode: 'walking' }); expect(useComparison.getState().trips).toEqual({})
})
