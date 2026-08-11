import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { requestFingerprint, withCache } from './cache'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

const req = (over: Partial<IsochroneRequest> = {}): IsochroneRequest => ({
  lngLat: [116.397, 39.909],
  mode: 'transit',
  minutes: 30,
  policy: 'ALL',
  ...over,
})

function fakeProvider(): IsochroneProvider & { calls: number } {
  const p = {
    id: 'fake',
    supportedModes: ['transit'] as const,
    calls: 0,
    async fetch() {
      p.calls++
      return shape
    },
  }
  return p as unknown as IsochroneProvider & { calls: number }
}

describe('requestFingerprint', () => {
  it('相同参数得到相同指纹', () => {
    expect(requestFingerprint('amap', req())).toBe(requestFingerprint('amap', req()))
  })

  it('档位不同则指纹不同', () => {
    expect(requestFingerprint('amap', req())).not.toBe(
      requestFingerprint('amap', req({ minutes: 45 })),
    )
  })

  it('策略不同则指纹不同', () => {
    expect(requestFingerprint('amap', req())).not.toBe(
      requestFingerprint('amap', req({ policy: 'SUBWAY' })),
    )
  })

  it('坐标取到 5 位小数，抖动不影响命中', () => {
    expect(requestFingerprint('amap', req({ lngLat: [116.3970001, 39.9090001] })))
      .toBe(requestFingerprint('amap', req()))
  })
})

describe('withCache', () => {
  it('相同请求只打一次后端', async () => {
    const inner = fakeProvider()
    const cached = withCache(inner)
    await cached.fetch(req())
    await cached.fetch(req())
    expect(inner.calls).toBe(1)
  })

  it('不同档位分别请求', async () => {
    const inner = fakeProvider()
    const cached = withCache(inner)
    await cached.fetch(req())
    await cached.fetch(req({ minutes: 45 }))
    expect(inner.calls).toBe(2)
  })

  it('并发的相同请求合并成一次（防抖同飞）', async () => {
    const inner = fakeProvider()
    const cached = withCache(inner)
    await Promise.all([cached.fetch(req()), cached.fetch(req())])
    expect(inner.calls).toBe(1)
  })

  it('失败的请求不写入缓存，可以重试', async () => {
    let n = 0
    const flaky: IsochroneProvider = {
      id: 'flaky',
      supportedModes: ['transit'],
      async fetch() {
        n++
        if (n === 1) throw new Error('boom')
        return shape
      },
    }
    const cached = withCache(flaky)
    await expect(cached.fetch(req())).rejects.toThrow('boom')
    await expect(cached.fetch(req())).resolves.not.toBeNull()
    expect(n).toBe(2)
  })

  it('null 结果（无公交覆盖）会被缓存', async () => {
    let n = 0
    const emptyProvider: IsochroneProvider = {
      id: 'empty',
      supportedModes: ['transit'],
      async fetch() {
        n++
        return null
      },
    }
    const cached = withCache(emptyProvider)
    await cached.fetch(req())
    await cached.fetch(req())
    expect(n).toBe(1)
  })
})
