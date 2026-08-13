import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMapboxProvider } from './mapbox'
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

  it('支持全部四种方式', () => {
    const p = createMapboxProvider()
    expect(p.supportedModes).toEqual(['driving', 'driving-traffic', 'walking', 'cycling'])
  })
})
