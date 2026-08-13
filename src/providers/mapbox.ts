import { isochroneUrl, pickContour, describeMapboxError } from './mapboxTransform'
import { getMapboxToken } from '../mapbox/token'
import type { IsochroneProvider } from './cache'

/**
 * Mapbox Isochrone provider。
 * 返回的就是标准 GeoJSON——高德时代那套三层嵌套解析、字符串坐标、
 * union 归一化在这里都不存在。唯一要小心的档位匹配已在 pickContour 处理。
 */
export function createMapboxProvider(): IsochroneProvider {
  return {
    id: 'mapbox',
    supportedModes: ['driving', 'driving-traffic', 'walking', 'cycling'],

    async fetch(req) {
      const url = isochroneUrl(req.mode, req.lngLat, req.minutes, getMapboxToken())
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(describeMapboxError(res.status, body))
      }
      // null 表示该点该档无可达范围——有效结果，不是错误
      return pickContour(await res.json(), req.minutes)
    },
  }
}
