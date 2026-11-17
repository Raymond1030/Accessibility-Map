import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { booleanValid, kinks } from '@turf/turf'
import type { Polygon } from 'geojson'
import { createMapboxProvider } from './mapbox'
import { simplifyForOps } from '../geometry/ops'
import type { IsochroneRequest } from './cache'

const okBody = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { contour: 30 },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    },
  ],
}

const req = (over: Partial<IsochroneRequest> = {}): IsochroneRequest => ({
  lngLat: [113.9435, 22.5333],
  mode: 'driving',
  minutes: 30,
  ...over,
})

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
}

beforeEach(() => {
  vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('createMapboxProvider', () => {
  it('200 时返回对应档位的 Feature', async () => {
    globalThis.fetch = mockFetch(200, okBody)
    const f = await createMapboxProvider().fetch(req())
    expect(f).not.toBeNull()
    expect(f!.geometry.type).toBe('Polygon')
  })

  it('200 但无该档位（空可达范围）返回 null，不报错', async () => {
    globalThis.fetch = mockFetch(200, { type: 'FeatureCollection', features: [] })
    await expect(createMapboxProvider().fetch(req())).resolves.toBeNull()
  })

  it('401 时抛错且信息指向 token', async () => {
    globalThis.fetch = mockFetch(401, { message: 'Unauthorized' })
    await expect(createMapboxProvider().fetch(req())).rejects.toThrow(/token/)
  })

  it('429 时抛错，交给外层闸门退避重试', async () => {
    globalThis.fetch = mockFetch(429, { message: 'Too Many Requests' })
    await expect(createMapboxProvider().fetch(req())).rejects.toThrow(/频率/)
  })

  it('driving-traffic 请求走 driving-traffic profile', async () => {
    const spy = mockFetch(200, okBody)
    globalThis.fetch = spy
    await createMapboxProvider().fetch(req({ mode: 'driving-traffic' }))
    const url = (spy as any).mock.calls[0][0] as string
    expect(url).toContain('mapbox/driving-traffic')
  })

  it('网格台阶在出口处被平滑：仍是有效多边形，没有直角，档位属性不变', async () => {
    // 0.002° 网格（驾车 30 分钟）上的 1:1 台阶，斜边沿格子边一级级下来
    const cell = 0.002, [lng0, lat0] = [113.94, 22.53]
    const grid = [[0, 0], [10, 0], [10, 10]]
    for (let k = 10; k >= 1; k--) grid.push([k - 1, k], [k - 1, k - 1])
    const ring = grid.map(([x, y]) => [lng0 + x * cell, lat0 + y * cell])
    globalThis.fetch = mockFetch(200, {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { contour: 30 }, geometry: { type: 'Polygon', coordinates: [ring] } }],
    })
    const f = await createMapboxProvider().fetch(req())
    expect(f!.properties).toEqual({ contour: 30 })
    expect(f!.geometry.type).toBe('Polygon')
    expect(kinks(f!).features).toHaveLength(0)
    expect(booleanValid(f!)).toBe(true)
    const out = (f!.geometry as Polygon).coordinates[0]
    expect(out).not.toEqual(ring)
    // 输出里不再有原始的台阶角：在米制平面里量，每个顶点的转角都不超过 25°
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320 / 110574
    const turns = out.slice(0, -1).map((q, i, r) => {
      const p = r[(i - 1 + r.length) % r.length], s = r[(i + 1) % r.length]
      const a1 = Math.atan2(q[1] - p[1], (q[0] - p[0]) * kx), a2 = Math.atan2(s[1] - q[1], (s[0] - q[0]) * kx)
      let d = Math.abs(a2 - a1) * 180 / Math.PI
      if (d > 180) d = 360 - d
      return d
    })
    expect(Math.max(...turns)).toBeLessThanOrEqual(25)
    // 集合运算前的简化认得这份平滑结果，不会再按 10 米把圆角削回折线
    expect(simplifyForOps(f!)).toBe(f)
  })

  it('支持全部四种方式', () => {
    const p = createMapboxProvider()
    expect(p.supportedModes).toEqual(['driving', 'driving-traffic', 'walking', 'cycling'])
  })
})
