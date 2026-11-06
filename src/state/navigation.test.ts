import { expect, it, vi } from 'vitest'
vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
import { useNavigation } from './navigation'
import { useCommute } from '../commute/store'
import { useExplore } from '../explore/store'
import { useStore } from './store'

it('switches scenes without erasing inputs and cancels every old picking mode', () => {
  const home = { name: '测试住处', lngLat: [114, 22] as [number, number], id: 'home', rent: 3000 }
  useCommute.setState({ homes: [home], picking: 'home' }); useExplore.setState({ center: home, picking: true }); useStore.setState({ pickingMode: true })
  useNavigation.getState().setScene('explore')
  expect(useNavigation.getState().scene).toBe('explore'); expect(useCommute.getState().picking).toBeNull(); expect(useExplore.getState().picking).toBe(false); expect(useStore.getState().pickingMode).toBe(false)
  useNavigation.getState().setScene('commute'); expect(useCommute.getState().homes).toEqual([home]); expect(useExplore.getState().center).toEqual(home)
})
