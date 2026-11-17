vi.mock('../amap/loader', () => ({ loadAmap: vi.fn() }))
import { afterEach, expect, it, vi } from 'vitest'
import { RequestPool, routeFingerprint } from './requests'

afterEach(() => vi.useRealTimers())
it('shares requests, limits concurrency, and releases slots on failure', async () => {
  const pool = new RequestPool(2); let active = 0; let peak = 0
  const work = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return 7 })
  expect(await Promise.all([pool.run('a', work), pool.run('a', work), pool.run('b', work), pool.run('c', work)])).toEqual([7, 7, 7, 7])
  expect(work).toHaveBeenCalledTimes(3); expect(peak).toBe(2)
  await expect(pool.run('bad', async () => { throw new Error('bad') })).rejects.toThrow('bad')
  expect(await pool.run('next', async () => 8)).toBe(8)
})
it('expires cached values and does not cache errors', async () => {
  vi.useFakeTimers(); const pool = new RequestPool(2, 100); const work = vi.fn().mockResolvedValue(null)
  await pool.run('a', work); await pool.run('a', work); expect(work).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(101); await pool.run('a', work); expect(work).toHaveBeenCalledTimes(2)
  const failing = vi.fn().mockRejectedValueOnce(new Error('retry')).mockResolvedValueOnce(4)
  await expect(pool.run('b', failing)).rejects.toThrow(); expect(await pool.run('b', failing)).toBe(4)
})
it('times out a stuck callback and resumes queued work', async () => {
  vi.useFakeTimers(); const pool = new RequestPool(1, 100, 50)
  const stuck = expect(pool.run('stuck', () => new Promise(() => {}))).rejects.toThrow('超时')
  const next = pool.run('next', async () => 9)
  await vi.advanceTimersByTimeAsync(51); await stuck; expect(await next).toBe(9)
})
it('cancels queued stale requests before calling the service', async () => {
  const pool = new RequestPool(1); let done!: (n: number) => void
  const first = pool.run('a', () => new Promise<number>(r => { done = r }))
  await Promise.resolve(); const controller = new AbortController(); const work = vi.fn(async () => 2)
  const cancelled = expect(pool.run('b', work, controller.signal)).rejects.toThrow('取消')
  controller.abort(); await vi.waitFor(() => expect(done).toBeTypeOf('function')); done(1); await first; await cancelled; expect(work).not.toHaveBeenCalled()
})
it('direction, cities, and modes form part of the route key', () => {
  const r = { origin: [1, 2] as [number, number], destination: [3, 4] as [number, number], city: 'A', destinationCity: 'B', mode: 'transit' as const }
  expect(routeFingerprint(r)).not.toBe(routeFingerprint({ ...r, origin: r.destination, destination: r.origin }))
  expect(routeFingerprint(r)).not.toBe(routeFingerprint({ ...r, destinationCity: 'C' }))
  expect(routeFingerprint(r)).not.toBe(routeFingerprint({ ...r, mode: 'walking' }))
})
it('paces request starts and retries service QPS failures', async () => {
  vi.useFakeTimers(); const pool = new RequestPool(2, 100, 15_000, 1100)
  const starts: number[] = []; const work = vi.fn(async () => { starts.push(Date.now()); if (starts.length === 1) throw new Error('CUQPS_HAS_EXCEEDED_THE_LIMIT'); return 1 })
  const a = pool.run('a', work); const b = pool.run('b', work)
  await vi.advanceTimersByTimeAsync(5000)
  expect(await a).toBe(1); expect(await b).toBe(1)
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100); expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1100)
})

it('retries an identical queued query without inheriting the previous caller cancellation', async () => {
  const pool = new RequestPool(1)
  let release!: () => void
  const blocker = pool.run('busy', () => new Promise<void>(resolve => { release = resolve }))
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const controller = new AbortController()
  const staleWork = vi.fn(async () => 'stale')
  const cancelled = expect(pool.run('same-query', staleWork, controller.signal)).rejects.toThrow('取消')
  controller.abort()
  const freshWork = vi.fn(async () => 'fresh')
  const retry = pool.run('same-query', freshWork)
  const sharedRetry = pool.run('same-query', freshWork)
  release()
  await Promise.all([blocker, cancelled])
  expect(await Promise.all([retry, sharedRetry])).toEqual(['fresh', 'fresh'])
  expect(staleWork).not.toHaveBeenCalled()
  expect(freshWork).toHaveBeenCalledTimes(1)
})

it('stops rate-limit retries once the request has timed out and releases the queue', async () => {
  vi.useFakeTimers()
  const pool = new RequestPool(1, 100, 50)
  const throttled = vi.fn().mockRejectedValueOnce(new Error('CUQPS_HAS_EXCEEDED_THE_LIMIT')).mockResolvedValue(1)
  const timeout = expect(pool.run('throttled', throttled)).rejects.toThrow('超时')
  const next = pool.run('next', async () => 2)
  await vi.advanceTimersByTimeAsync(51)
  await timeout
  expect(await next).toBe(2)
  await vi.advanceTimersByTimeAsync(2000)
  expect(throttled).toHaveBeenCalledTimes(1)
})
