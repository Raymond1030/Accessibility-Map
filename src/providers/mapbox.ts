import {
  isochroneUrl, pickContour, describeMapboxError, mapboxGridCeiling, MAPBOX_PROFILE, type MapboxMode,
} from './mapboxTransform'
import { getMapboxToken } from '../mapbox/token'
import { smoothIsochrone } from '../geometry/smooth'
import type { IsochroneProvider } from './cache'

/**
 * Mapbox Isochrone provider。
 * 返回的就是标准 GeoJSON——高德时代那套三层嵌套解析、字符串坐标、
 * union 归一化在这里都不存在。唯一要小心的档位匹配已在 pickContour 处理。
 *
 * Mapbox 的轮廓是网格等值线，沿格子边走成锯齿台阶，所以出口处平滑一次：
 * 缓存、地图绘制和 POI 筛选拿到的都是这份平滑结果。集合运算和地铁步行合并前还会经
 * simplifyForOps 抽稀，但平滑结果登记了自身精度（约 0.025 格），抽稀不会比它更粗。
 */
export function createMapboxProvider(): IsochroneProvider {
  return {
    id: 'mapbox',
    supportedModes: ['driving', 'driving-traffic', 'walking', 'cycling'],

    async fetch(req) {
      if (!(req.mode in MAPBOX_PROFILE)) {
        throw new Error(`Mapbox 等时圈不支持该出行方式：${req.mode}`)
      }
      const mode = req.mode as MapboxMode
      const url = isochroneUrl(mode, req.lngLat, req.minutes, getMapboxToken())
      const res = await fetch(url, { signal: req.signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(describeMapboxError(res.status, body))
      }
      // null 表示该点该档无可达范围——有效结果，不是错误
      const contour = pickContour(await res.json(), req.minutes)
      return contour && smoothIsochrone(contour, { maxCellDeg: mapboxGridCeiling(mode, req.minutes) })
    },
  }
}
