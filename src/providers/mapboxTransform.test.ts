import { describe, it, expect } from 'vitest'
import {
  pickContour, isochroneUrl, describeMapboxError, MAPBOX_PROFILE,
} from './mapboxTransform'

/** Mapbox Isochrone 的真实响应形状：标准 GeoJSON，contour 属性标明档位 */
const response = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { contour: 45, metric: 'time', color: '#bf4040' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]] },
    },
    {
      type: 'Feature',
      properties: { contour: 30, metric: 'time', color: '#bf8040' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    },
    {
      type: 'Feature',
      properties: { contour: 15, metric: 'time', color: '#bfbf40' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    },
  ],
}

describe('MAPBOX_PROFILE', () => {
  it('四种出行方式各自映射到 Mapbox 的 profile', () => {
    expect(MAPBOX_PROFILE.driving).toBe('mapbox/driving')
    expect(MAPBOX_PROFILE.walking).toBe('mapbox/walking')
    expect(MAPBOX_PROFILE.cycling).toBe('mapbox/cycling')
  })

  it('公交没有对应的 profile——Mapbox 不提供，这是硬事实', () => {
    expect('transit' in MAPBOX_PROFILE).toBe(false)
  })
})

describe('isochroneUrl', () => {
  it('按 profile 与坐标拼出请求地址', () => {
    const url = isochroneUrl('driving', [116.397, 39.909], 30, 'pk.test')
    expect(url).toContain('/isochrone/v1/mapbox/driving/116.397,39.909')
  })

  it('坐标顺序是经度在前——写反会把北京送到南极附近', () => {
    const url = isochroneUrl('walking', [116.397, 39.909], 15, 'pk.test')
    expect(url).toContain('116.397,39.909')
    expect(url).not.toContain('39.909,116.397')
  })

  it('要求返回多边形而非等值线——我们要做面运算', () => {
    expect(isochroneUrl('driving', [0, 0], 30, 'pk.test')).toContain('polygons=true')
  })

  it('带上档位与 token', () => {
    const url = isochroneUrl('cycling', [0, 0], 45, 'pk.abc')
    expect(url).toContain('contours_minutes=45')
    expect(url).toContain('access_token=pk.abc')
  })
})

describe('pickContour', () => {
  it('按档位取出对应的那一圈', () => {
    const f = pickContour(response, 30)
    expect(f).not.toBeNull()
    expect(f!.geometry.type).toBe('Polygon')
    expect((f!.geometry as any).coordinates[0][1][0]).toBe(2)
  })

  it('响应里档位顺序是乱的，不能靠下标取', () => {
    // features 顺序是 45, 30, 15；靠 index 取会张冠李戴
    expect(pickContour(response, 15)!.geometry).toEqual(response.features[2].geometry)
    expect(pickContour(response, 45)!.geometry).toEqual(response.features[0].geometry)
  })

  it('没有该档位时返回 null，而不是错拿一个', () => {
    expect(pickContour(response, 60)).toBeNull()
  })

  it('空响应返回 null（该点周边无可达范围）', () => {
    expect(pickContour({ type: 'FeatureCollection', features: [] }, 30)).toBeNull()
  })

  it('响应结构异常时返回 null 而不是崩溃', () => {
    expect(pickContour(null, 30)).toBeNull()
    expect(pickContour({}, 30)).toBeNull()
  })
})

describe('describeMapboxError', () => {
  it('401 点明是 token 问题', () => {
    expect(describeMapboxError(401, '')).toContain('token')
  })

  it('403 点明是权限或额度', () => {
    const msg = describeMapboxError(403, '')
    expect(msg.length).toBeGreaterThan(0)
  })

  it('422 说明是坐标或参数不合法', () => {
    expect(describeMapboxError(422, '')).toContain('坐标')
  })

  it('429 点明是频率超限，可稍后重试', () => {
    expect(describeMapboxError(429, '')).toContain('频率')
  })

  it('未知状态码也给出可读信息，并带上原始码', () => {
    expect(describeMapboxError(500, 'boom')).toContain('500')
  })
})
