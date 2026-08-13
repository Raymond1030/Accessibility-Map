import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { withTimeout, ProviderTimeoutError } from './timeout'
import { withGate, MAX_CONCURRENCY } from './gate'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

const req = (minutes: number): IsochroneRequest => ({
  lngLat: [116.397, 39.909],
  mode: 'driving',
  minutes,
})

/** 复现高德域名被拒时的行为：回调永不触发，Promise 永远 pending */
const neverResolves: IsochroneProvider = {
  id: 'never',
  supportedModes: ['driving'],
  fetch() {
    return new Promise<PolyFeature | null>(() => {})
  },
}

describe('withTimeout', () => {
  it('回调永不触发时抛出超时错误，而不是永远挂住', async () => {
    const p = withTimeout(neverResolves, 20)
    await expect(p.fetch(req(30))).rejects.toThrow(ProviderTimeoutError)
  })

  it('超时错误带上档位，便于定位是哪一格', async () => {
    const p = withTimeout(neverResolves, 20)
    await expect(p.fetch(req(45))).rejects.toThrow(/45/)
  })

  it('正常返回时不受影响', async () => {
    const fast: IsochroneProvider = {
      id: 'fast',
      supportedModes: ['driving'],
      async fetch() { return shape },
    }
    const p = withTimeout(fast, 1000)
    await expect(p.fetch(req(30))).resolves.not.toBeNull()
  })

  it('null 结果（无公交覆盖）能正常穿过', async () => {
    const emptyP: IsochroneProvider = {
      id: 'empty',
      supportedModes: ['driving'],
      async fetch() { return null },
    }
    const p = withTimeout(emptyP, 1000)
    await expect(p.fetch(req(30))).resolves.toBeNull()
  })
})

describe('withTimeout 与并发闸门组合', () => {
  it('挂死的请求不会堵死闸门——这是没有超时保护时的实际故障', async () => {
    // 先塞满闸门的全部名额，全都是永不回调的请求
    const gated = withGate(withTimeout(neverResolves, 20), { retries: 0, baseDelayMs: 1 })
    const stuck = Array.from({ length: MAX_CONCURRENCY }, (_, i) => gated.fetch(req(i)))
    await Promise.allSettled(stuck)

    // 闸门应已释放，后续请求还能进得来
    const healthy: IsochroneProvider = {
      id: 'healthy',
      supportedModes: ['driving'],
      async fetch() { return shape },
    }
    const gatedHealthy = withGate(withTimeout(healthy, 1000))
    await expect(gatedHealthy.fetch(req(99))).resolves.not.toBeNull()
  })

  it('超时会触发重试，重试成功则整体成功', async () => {
    let n = 0
    const slowThenFast: IsochroneProvider = {
      id: 'slowThenFast',
      supportedModes: ['driving'],
      fetch() {
        n++
        if (n === 1) return new Promise<PolyFeature | null>(() => {})
        return Promise.resolve(shape)
      },
    }
    const p = withGate(withTimeout(slowThenFast, 20), { retries: 2, baseDelayMs: 1 })
    await expect(p.fetch(req(30))).resolves.not.toBeNull()
    expect(n).toBe(2)
  })
})
