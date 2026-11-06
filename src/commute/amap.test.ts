import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCommuteRoute, parseRoute } from './amap'
import { loadAmap } from '../amap/loader'
import { wgs84ToGcj02 } from '../geo/coord'
vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))

beforeEach(() => { vi.resetAllMocks(); vi.useRealTimers() })
describe('高德通勤响应', () => {
  it('从有效方案中选耗时最短的，缺字段不能视为零分钟', () => {
    expect(parseRoute({ routes: [{ distance: 100 }, { time: 90, distance: 900 }, { time: '60', distance: '800' }] }, 'walking')?.seconds).toBe(60)
    expect(() => parseRoute({ routes: [{ time: '', distance: 1 }] }, 'driving')).toThrow('缺少')
    expect(parseRoute({ routes: [] }, 'cycling')).toBeNull()
  })
  it('解析公交步行、换乘、票价，分段轨迹转换回 WGS-84', () => {
    const p: [number, number] = [114.05, 22.55]
    const gcj = wgs84ToGcj02(p)
    const result = parseRoute({ plans: [{ time: 1800, distance: 9000, walking_distance: 600, cost: 5,
      segments: [
        { transit_mode: 'WALK', instruction: '步行到地铁站', transit: { path: [{ lng: gcj[0], lat: gcj[1] }, [gcj[0] + .001, gcj[1]]] } },
        { transit_mode: 'SUBWAY', instruction: '乘坐1号线', transit: {} },
        { transit_mode: 'WALK', transit: {} },
        { transit_mode: 'BUS', instruction: '换乘公交', transit: {} },
      ] }] }, 'transit')!
    expect(result).toMatchObject({ seconds: 1800, meters: 9000, walkingMeters: 600, transfers: 1, fare: 5 })
    expect(result.instructions).toEqual(['步行到地铁站', '乘坐1号线', '换乘公交'])
    expect(result.paths[0][0][0]).toBeCloseTo(p[0], 4)
    expect(result.paths[0][0][1]).toBeCloseTo(p[1], 4)
  })
  it('不伪造未知票价和缺失路线轨迹', () => {
    const route = parseRoute({ plans: [{ time: 600, distance: 900 }] }, 'transit')!
    expect(route.fare).toBeUndefined()
    expect(route.transfers).toBeUndefined()
    expect(route.paths).toEqual([])
  })
})
const request = { origin: [114, 22.5] as [number, number], destination: [114.1, 22.6] as [number, number], city: '深圳', destinationCity: '深圳', mode: 'transit' as const }
it('保持住处到公司的方向，公交城市和策略传给 SDK', async () => {
  const search = vi.fn((_a, _b, cb) => cb('complete', { plans: [{ time: 600, distance: 900 }] }))
  const Transfer = vi.fn(function () { return { search } })
  vi.mocked(loadAmap).mockResolvedValue({ Transfer, TransferPolicy: { LEAST_TIME: 0 } })
  expect((await fetchCommuteRoute(request))?.seconds).toBe(600)
  expect(Transfer).toHaveBeenCalledWith(expect.objectContaining({ city: '深圳', cityd: '深圳', policy: 0 }))
  expect(search.mock.calls[0][0]).toEqual(wgs84ToGcj02(request.origin))
  expect(search.mock.calls[0][1]).toEqual(wgs84ToGcj02(request.destination))
})
it('无路线和服务错误分别报告', async () => {
  const search = vi.fn((_a, _b, cb) => cb('no_data', {}))
  vi.mocked(loadAmap).mockResolvedValue({ Transfer: function () { return { search } }, TransferPolicy: { LEAST_TIME: 0 } })
  expect(await fetchCommuteRoute(request)).toBeNull()
  search.mockImplementation((_a, _b, cb) => cb('error', 'INVALID_USER_KEY'))
  await expect(fetchCommuteRoute(request)).rejects.toThrow('INVALID_USER_KEY')
})
it('SDK 不响应时超时，迟到回调不会改变结果', async () => {
  vi.useFakeTimers()
  vi.mocked(loadAmap).mockReturnValue(new Promise(() => {}))
  const promise = fetchCommuteRoute(request, 10)
  const assertion = expect(promise).rejects.toThrow('超时')
  await vi.advanceTimersByTimeAsync(11)
  await assertion
  vi.useRealTimers()
})

it('保留地铁和公交线路、同段备选线路以及上下车站，步行不占用乘车颜色', () => {
  const result = parseRoute({ plans: [{ time: 1000, distance: 2000, segments: [
    { transit_mode: 'WALK', distance: 200, time: 180, transit: {} },
    { transit_mode: 'SUBWAY', transit: { lines: [{ name: '1号线(罗湖--机场东)' }],
      on_station: { name: '深大', location: { lng: 113.95, lat: 22.54 } }, off_station: { name: '桃园' }, via_num: 0 } },
    { transit_mode: 'WALK', transit: {} },
    { transit_mode: 'BUS', transit: { lines: [{ name: 'M109路' }, { name: '72路' }], on_station: { name: '桃园地铁站' }, off_station: { name: '科技园' }, via_num: '3' } },
  ] }] }, 'transit')!
  expect(result.transitLegs?.[1]).toMatchObject({ mode: 'SUBWAY', lines: ['1号线(罗湖--机场东)'], from: '深大', to: '桃园', viaStops: 0, color: '#1769aa' })
  expect(result.transitLegs?.[1].fromLocation?.[0]).not.toBe(113.95)
  expect(result.transitLegs?.[1].toLocation).toBeUndefined()
  expect(result.transitLegs?.[3]).toMatchObject({ lines: ['M109路', '72路'], viaStops: 3, color: '#b45309' })
  expect(result.transfers).toBe(1)
})
it('缺少线路和站点不会伪造名称，非公交不附带乘车分段', () => {
  const route = parseRoute({ plans: [{ time: 60, distance: 20, segments: [{ transit_mode: 'BUS', transit: {} }] }] }, 'transit')!
  expect(route.transitLegs?.[0]).toMatchObject({ lines: [], path: [] })
  expect(route.transitLegs?.[0].from).toBeUndefined()
  expect(parseRoute({ routes: [{ time: 60, distance: 20 }] }, 'driving')?.transitLegs).toBeUndefined()
})
