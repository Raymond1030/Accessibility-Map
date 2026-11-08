import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from './store'
import { getProvider } from '../providers'
vi.mock('../providers', () => ({ getProvider: vi.fn() }))
const fetchRange = vi.fn()
const origin = { id: 'a', label: '九龙', lngLat: [114.17, 22.3] as [number, number], mode: 'transit-walking' as const, visible: true, color: '#123456', thresholds: [15] }
beforeEach(() => {
  vi.stubEnv('VITE_LOCAL_ENGINE_URL', 'http://127.0.0.1:8787')
  fetchRange.mockReset().mockResolvedValue(null)
  vi.mocked(getProvider).mockReturnValue({ id: 'local', supportedModes: ['transit-walking'], fetch: fetchRange })
  useStore.setState({ origins: [origin], globalThresholds: [15], bandMode: 'paired', cells: new Map(), geoms: new Map(), errors: new Map() })
})
afterEach(() => vi.unstubAllEnvs())

it('多点公交请求带全局时刻和方向；旧查询迟到不能覆盖新条件', async () => {
  useStore.setState({ localDateTime: '2026-11-07T08:00', localDirection: 'arrive' })
  const oldGeometry = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[114,22],[114.1,22],[114,22.1],[114,22]]] } }
  let complete!: (value: typeof oldGeometry) => void
  fetchRange.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const old = useStore.getState().refresh()
  useStore.getState().setLocalQuery({ localDateTime: '2026-11-07T09:00' })
  expect(useStore.getState().geoms.size).toBe(0)
  await vi.waitFor(() => expect(fetchRange).toHaveBeenCalledTimes(2))
  expect(fetchRange.mock.calls[1][0]).toMatchObject({ dateTime: '2026-11-07T09:00:00+08:00', direction: 'arrive' })
  expect(fetchRange.mock.calls[0][0].signal.aborted).toBe(true)
  complete(oldGeometry)
  await old
  expect(useStore.getState().localDateTime).toBe('2026-11-07T09:00')
  expect(useStore.getState().cells.get('a@15')).toBe('empty')
  expect(useStore.getState().geoms.get('a@15')).toBeNull()
})
