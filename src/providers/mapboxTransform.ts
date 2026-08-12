import type { PolyFeature } from '../geometry/ops'

/**
 * 出行方式 → Mapbox profile。
 *
 * 注意这里没有 transit：Mapbox Isochrone 只提供 driving / driving-traffic /
 * walking / cycling 四种，不支持公共交通。这是接口本身的限制，不是遗漏。
 */
export const MAPBOX_PROFILE = {
  driving: 'mapbox/driving',
  walking: 'mapbox/walking',
  cycling: 'mapbox/cycling',
} as const

export type MapboxMode = keyof typeof MAPBOX_PROFILE

const BASE = 'https://api.mapbox.com/isochrone/v1'

/** 坐标顺序是「经度,纬度」——写反会把北京送到南极附近 */
export function isochroneUrl(
  mode: MapboxMode,
  [lng, lat]: [number, number],
  minutes: number,
  token: string,
): string {
  const profile = MAPBOX_PROFILE[mode]
  const q = new URLSearchParams({
    contours_minutes: String(minutes),
    polygons: 'true',
    denoise: '1',
    access_token: token,
  })
  return `${BASE}/${profile}/${lng},${lat}?${q.toString()}`
}

/**
 * 从响应里取出指定档位的那一圈。
 *
 * 必须按 properties.contour 匹配，不能靠数组下标：Mapbox 返回的
 * features 是按档位从大到小排的，靠 index 取会张冠李戴——
 * 拿 15 分钟的下标却得到 45 分钟的范围，面积大三倍且毫无异常迹象。
 */
export function pickContour(response: unknown, minutes: number): PolyFeature | null {
  if (!response || typeof response !== 'object') return null
  const features = (response as { features?: unknown }).features
  if (!Array.isArray(features)) return null

  for (const f of features) {
    if (f?.properties?.contour === minutes && f.geometry) {
      return f as PolyFeature
    }
  }
  return null
}

export function describeMapboxError(status: number, body: string): string {
  switch (status) {
    case 401:
      return 'Mapbox token 无效或缺失，请检查 VITE_MAPBOX_TOKEN。'
    case 403:
      return 'Mapbox 拒绝了请求：token 权限不足或账户额度已用尽。'
    case 422:
      return '坐标或参数不合法，Mapbox 无法计算该点的等时圈。'
    case 429:
      return '请求频率超限，稍后会自动重试。'
    default:
      return `Mapbox 请求失败（HTTP ${status}）${body ? `：${body.slice(0, 120)}` : ''}`
  }
}
