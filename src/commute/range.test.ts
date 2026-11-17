import { beforeEach, expect, it, vi } from 'vitest'
import { polygon } from '@turf/turf'
import { useCommute } from './store'
import { getProvider } from '../providers'
import { fetchCommuteRoute } from './amap'
import { RANGE_MODES } from './range'
vi.mock('../providers', () => ({ getProvider: vi.fn() }))
vi.mock('./amap', () => ({ fetchCommuteRoute: vi.fn() }))
const fetchRange = vi.fn()
const place = { name: '工作地', lngLat: [114, 22.5] as [number, number] }
const geometry = polygon([[[114, 22.5], [114.01, 22.5], [114, 22.51], [114, 22.5]]])
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getProvider).mockReturnValue({ id: 'test', supportedModes: RANGE_MODES, fetch: fetchRange })
  useCommute.setState({ workplace: null, homes: [], view: 'range' })
  useCommute.getState().setRangeMode('subway-walking')
  useCommute.getState().setRangeMinutes(30)
})
it('只设置工作地即可生成圈，不依赖候选住处或点到点通勤请求', async () => {
  fetchRange.mockResolvedValue(geometry)
  useCommute.getState().setWorkplace(place)
  await useCommute.getState().evaluateRange()
  expect(fetchRange).toHaveBeenCalledWith({ lngLat: place.lngLat, mode: 'subway-walking', minutes: 30, direction: 'arrive', signal: expect.any(AbortSignal), onProgress: expect.any(Function) })
  expect(useCommute.getState().rangeResult).toEqual({ status: 'ok', geometry })
  expect(fetchCommuteRoute).not.toHaveBeenCalled()
  expect(useCommute.getState().homes).toEqual([])
})
it.each(RANGE_MODES)('四种方式使用对应数据源：%s', async mode => {
  fetchRange.mockResolvedValue(geometry)
  useCommute.getState().setWorkplace(place)
  useCommute.getState().setRangeMode(mode)
  await useCommute.getState().evaluateRange()
  expect(getProvider).toHaveBeenCalledWith(mode)
  expect(fetchRange).toHaveBeenCalledWith(expect.objectContaining({ mode }))
})
it.each(['mode', 'minutes', 'workplace'])('改变%s作废旧请求，不显示上一个条件的圈', async field => {
  let finish!: (value: typeof geometry) => void
  fetchRange.mockReturnValue(new Promise(resolve => { finish = resolve }))
  useCommute.getState().setWorkplace(place)
  const pending = useCommute.getState().evaluateRange()
  if (field === 'mode') useCommute.getState().setRangeMode('cycling')
  if (field === 'minutes') useCommute.getState().setRangeMinutes(45)
  if (field === 'workplace') useCommute.getState().setWorkplace({ ...place, name: '新工作地' })
  finish(geometry)
  await pending
  expect(useCommute.getState().rangeResult.status).toBe('idle')
})
it('错误和无覆盖分别展示，失败后可重试', async () => {
  useCommute.getState().setWorkplace(place)
  fetchRange.mockRejectedValueOnce(new Error('请求超时')).mockResolvedValueOnce(null).mockResolvedValueOnce(geometry)
  await useCommute.getState().evaluateRange()
  expect(useCommute.getState().rangeResult).toEqual({ status: 'error', message: '请求超时' })
  await useCommute.getState().evaluateRange()
  expect(useCommute.getState().rangeResult.status).toBe('empty')
  await useCommute.getState().evaluateRange()
  expect(useCommute.getState().rangeResult.status).toBe('ok')
})
it('切换查看方式保留工作地和候选住处，退出地图选点', () => {
  useCommute.getState().setWorkplace(place)
  useCommute.getState().addHome(place)
  useCommute.getState().setPicking('home')
  useCommute.getState().setView('range')
  expect(useCommute.getState().picking).toBeNull()
  useCommute.getState().setView('compare')
  expect(useCommute.getState().workplace).toEqual(place)
  expect(useCommute.getState().homes).toHaveLength(1)
})
it('未设工作地不请求，分钟范围限制为1至60', async () => {
  await useCommute.getState().evaluateRange()
  expect(fetchRange).not.toHaveBeenCalled()
  useCommute.getState().setRangeMinutes(100)
  expect(useCommute.getState().rangeMinutes).toBe(60)
  useCommute.getState().setRangeMinutes(-1)
  expect(useCommute.getState().rangeMinutes).toBe(1)
})


it('修改条件终止地铁队列，过期进度不污染新状态', async () => {
  let finish!: (value: typeof geometry) => void
  fetchRange.mockReturnValue(new Promise(resolve => { finish = resolve }))
  useCommute.getState().setWorkplace(place)
  const pending = useCommute.getState().evaluateRange()
  const request = fetchRange.mock.calls[0][0]
  request.onProgress('车站 1/5')
  expect(useCommute.getState().rangeResult).toEqual({ status: 'loading', message: '车站 1/5' })
  useCommute.getState().setRangeMinutes(45)
  expect(request.signal.aborted).toBe(true)
  request.onProgress('旧任务')
  finish(geometry)
  await pending
  expect(useCommute.getState().rangeResult).toEqual({ status: 'idle' })
})
