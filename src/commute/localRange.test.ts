import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCommute } from './store'
import { getProvider } from '../providers'
vi.mock('../providers', () => ({ getProvider: vi.fn() }))
vi.mock('./amap', () => ({ fetchCommuteRoute: vi.fn() }))
const fetchRange = vi.fn()
beforeEach(() => {
  vi.stubEnv('VITE_LOCAL_ENGINE_URL', 'http://127.0.0.1:8787')
  fetchRange.mockReset().mockResolvedValue(null)
  vi.mocked(getProvider).mockReturnValue({ id: 'local', supportedModes: ['walking', 'transit-walking'], fetch: fetchRange })
  useCommute.getState().setWorkplace({ name: '九龙', lngLat: [114.17, 22.3] })
})
afterEach(() => vi.unstubAllEnvs())

it('本地公交传递东八区到达时刻，改时刻立即清除旧结果', async () => {
  const s = useCommute.getState()
  s.setRangeMode('transit-walking')
  s.setRangeDateTime('2026-11-07T08:30')
  s.setRangeDirection('arrive')
  await s.evaluateRange()
  expect(fetchRange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'transit-walking', dateTime: '2026-11-07T08:30:00+08:00', direction: 'arrive', signal: expect.any(AbortSignal) }))
  expect(useCommute.getState().rangeResult.status).toBe('empty')
  s.setRangeDateTime('2026-11-07T09:30')
  expect(useCommute.getState().rangeResult.status).toBe('idle')
})

it('本地道路也能请求到达方向，改方向会取消旧查询', async () => {
  const s = useCommute.getState()
  s.setRangeMode('walking')
  s.setRangeDirection('arrive')
  await s.evaluateRange()
  const request = fetchRange.mock.calls[0][0]
  expect(request.direction).toBe('arrive')
  s.setRangeDirection('depart')
  expect(request.signal.aborted).toBe(true)
  expect(useCommute.getState().rangeResult.status).toBe('idle')
})
