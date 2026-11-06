import { beforeEach, expect, it, vi } from 'vitest'
import { useCommute } from './store'
import { fetchCommuteRoute } from './amap'
import { eligibility, routeKey, type Route } from './types'
vi.mock('./amap', () => ({ fetchCommuteRoute: vi.fn() }))
vi.mock('../providers', () => ({ getProvider: vi.fn() }))
const route: Route = { seconds: 1800, meters: 5000, paths: [], instructions: [], fetchedAt: 1 }
const place = { name: '公司', lngLat: [114, 22.5] as [number, number] }
beforeEach(() => {
  vi.resetAllMocks()
  useCommute.getState().setWorkplace(place)
  useCommute.setState({ homes: [], cells: {}, busy: false, city: '深圳', destinationCity: '深圳' })
})
it('筛选按秒比较，未知租金/失败/空路线不得算作符合条件', () => {
  const home = { ...place, id: 'a', rent: null }
  expect(eligibility(home, { status: 'ok', route }, 30, 4000)).toBe('待填租金')
  expect(eligibility(home, { status: 'ok', route }, 30, null)).toBe('符合条件')
  expect(eligibility(home, { status: 'ok', route: { ...route, seconds: 1801 } }, 30, null)).toBe('通勤超时')
  expect(eligibility(home, { status: 'error', message: 'quota' }, 30, null)).toBe('数据不全')
  expect(eligibility(home, { status: 'empty' }, 30, null)).toBe('无可用路线')
  expect(eligibility({ ...home, rent: 5000 }, { status: 'ok', route }, 30, 4000)).toBe('超出预算')
})
it('四种方式独立完成，失败不隐藏其余成功结果', async () => {
  useCommute.getState().addHome({ ...place, name: '小区' })
  vi.mocked(fetchCommuteRoute).mockImplementation(async req => {
    if (req.mode === 'cycling') throw new Error('配额用尽')
    return req.mode === 'walking' ? null : route
  })
  await useCommute.getState().evaluate()
  const s = useCommute.getState(), id = s.homes[0].id
  expect(s.cells[routeKey(id, 'transit')].status).toBe('ok')
  expect(s.cells[routeKey(id, 'walking')].status).toBe('empty')
  expect(s.cells[routeKey(id, 'cycling')].status).toBe('error')
  expect(s.busy).toBe(false)
  expect(fetchCommuteRoute).toHaveBeenCalledTimes(4)
})
it('改公司使在飞结果作废，并停止旧任务队列', async () => {
  useCommute.getState().addHome(place)
  let resolve!: (value: Route) => void
  const pending = new Promise<Route>(r => { resolve = r })
  vi.mocked(fetchCommuteRoute).mockReturnValue(pending)
  const run = useCommute.getState().evaluate()
  useCommute.getState().setWorkplace({ ...place, name: '新公司' })
  resolve(route)
  await run
  expect(useCommute.getState().cells).toEqual({})
  expect(fetchCommuteRoute).toHaveBeenCalledTimes(2)
})
it('删除候选住处后迟到结果不复活', async () => {
  useCommute.getState().addHome(place)
  let resolve!: (value: Route) => void
  vi.mocked(fetchCommuteRoute).mockReturnValue(new Promise(r => { resolve = r }))
  // 两个调用共用一个 promise，模拟同时在飞。
  const run = useCommute.getState().evaluate()
  useCommute.getState().removeHome(useCommute.getState().homes[0].id)
  resolve(route)
  await run
  expect(useCommute.getState().cells).toEqual({})
})
