import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { withGate, MAX_CONCURRENCY } from './gate'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

const req = (minutes: number): IsochroneRequest => ({
  lngLat: [116.397, 39.909],
  mode: 'transit',
  minutes,
  policy: 'ALL',
})

describe('withGate', () => {
  it('同时在飞的请求不超过上限', async () => {
    let active = 0
    let peak = 0
    const slow: IsochroneProvider = {
      id: 'slow',
      supportedModes: ['transit'],
      async fetch() {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
        return shape
      },
    }
    const gated = withGate(slow)
    await Promise.all(Array.from({ length: 12 }, (_, i) => gated.fetch(req(i))))
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY)
  })

  it('所有请求最终都完成', async () => {
    const p: IsochroneProvider = {
      id: 'p',
      supportedModes: ['transit'],
      async fetch() { return shape },
    }
    const gated = withGate(p)
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => gated.fetch(req(i))))
    expect(results).toHaveLength(12)
    expect(results.every((r) => r !== null)).toBe(true)
  })

  it('失败后按退避重试并最终成功', async () => {
    let n = 0
    const flaky: IsochroneProvider = {
      id: 'flaky',
      supportedModes: ['transit'],
      async fetch() {
        n++
        if (n < 3) throw new Error('QPS 超限')
        return shape
      },
    }
    const gated = withGate(flaky, { retries: 3, baseDelayMs: 1 })
    await expect(gated.fetch(req(30))).resolves.not.toBeNull()
    expect(n).toBe(3)
  })

  it('重试用尽后抛出最后一次的错误', async () => {
    const broken: IsochroneProvider = {
      id: 'broken',
      supportedModes: ['transit'],
      async fetch() { throw new Error('一直失败') },
    }
    const gated = withGate(broken, { retries: 2, baseDelayMs: 1 })
    await expect(gated.fetch(req(30))).rejects.toThrow('一直失败')
  })

  it('一个请求失败不会卡住闸门', async () => {
    let n = 0
    const mixed: IsochroneProvider = {
      id: 'mixed',
      supportedModes: ['transit'],
      async fetch() {
        n++
        if (n === 1) throw new Error('第一个失败')
        return shape
      },
    }
    const gated = withGate(mixed, { retries: 0, baseDelayMs: 1 })
    const results = await Promise.allSettled([
      gated.fetch(req(15)), gated.fetch(req(30)), gated.fetch(req(45)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })
})
