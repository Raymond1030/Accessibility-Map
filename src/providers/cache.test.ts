import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { requestFingerprint, withCache } from './cache'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

const req = (over: Partial<IsochroneRequest> = {}): IsochroneRequest => ({
  lngLat: [116.397, 39.909],
  mode: 'driving',
  minutes: 30,
  ...over,
})

function fakeProvider(): IsochroneProvider & { calls: number } {
  const p = {
    id: 'fake',
    supportedModes: ['driving'] as const,
    calls: 0,
    async fetch() {
      p.calls++
      return shape
    },
  }
  return p as unknown as IsochroneProvider & { calls: number }
}

describe('driving-traffic 的时间桶', () => {
  const tReq = (over: Partial<IsochroneRequest> = {}): IsochroneRequest => ({
    lngLat: [116.397, 39.909], mode: 'driving-traffic', minutes: 30, ...over,
  })

  // 对齐到桶起点，避免测试数据恰好踩在桶边界上
  const bucketStart = 1666 * 600_000

  it('同一 10 分钟窗口内指纹相同——会话内仍享受零请求', () => {
    expect(requestFingerprint('mb', tReq(), bucketStart))
      .toBe(requestFingerprint('mb', tReq(), bucketStart + 9 * 60_000))
  })

  it('跨窗口指纹不同——路况过期后重新获取', () => {
    expect(requestFingerprint('mb', tReq(), bucketStart))
      .not.toBe(requestFingerprint('mb', tReq(), bucketStart + 11 * 60_000))
  })

  it('普通驾车不含时间桶，任何时刻指纹一致', () => {
    const d = (now: number) => requestFingerprint('mb', tReq({ mode: 'driving' }), now)
    expect(d(0)).toBe(d(999_999_999))
  })
})

describe('requestFingerprint', () => {
  it('相同参数得到相同指纹', () => {
    expect(requestFingerprint('amap', req())).toBe(requestFingerprint('amap', req()))
  })

  it('档位不同则指纹不同', () => {
    expect(requestFingerprint('amap', req())).not.toBe(
      requestFingerprint('amap', req({ minutes: 45 })),
    )
  })

  it('出行方式不同则指纹不同', () => {
    expect(requestFingerprint('amap', req())).not.toBe(
      requestFingerprint('amap', req({ mode: 'walking' })),
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
      supportedModes: ['driving'],
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
      supportedModes: ['driving'],
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
