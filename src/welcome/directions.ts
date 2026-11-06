import { getMapboxToken } from '../mapbox/token'
import { measureRoute, type MeasuredRoute } from './story'

export type IntroRoute = { path: MeasuredRoute; meters: number; seconds: number }

/** Reject missing/invalid route data instead of drawing an invented straight connection. */
export function parseIntroRoute(body: unknown): IntroRoute {
  const response = body as { code?: unknown; routes?: { geometry?: { type?: unknown; coordinates?: unknown }; distance?: unknown; duration?: unknown }[] } | null
  if (response?.code !== 'Ok' || !Array.isArray(response.routes)) throw new Error('当前没有可用的驾车路线。')
  const route = response.routes[0]
  const coords = route?.geometry?.coordinates
  if (route?.geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length < 2 || !coords.every(p =>
    Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
    && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90,
  ) || typeof route.distance !== 'number' || !Number.isFinite(route.distance) || route.distance <= 0
    || typeof route.duration !== 'number' || !Number.isFinite(route.duration) || route.duration <= 0) {
    throw new Error('驾车路线数据不完整。')
  }
  return { path: measureRoute(coords.map(p => [p[0], p[1]])), meters: route.distance, seconds: route.duration }
}

const routes = new Map<string, Promise<IntroRoute>>()

/** One cached request for the public demo route; animation loops do not issue new requests. */
export function loadIntroRoute(start: [number, number], end: [number, number]): Promise<IntroRoute> {
  const coordinates = `${start.join(',')};${end.join(',')}`
  const cached = routes.get(coordinates)
  if (cached) return cached
  const request = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const params = new URLSearchParams({ geometries: 'geojson', overview: 'full', steps: 'false', access_token: getMapboxToken() })
      const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${params}`, { signal: controller.signal })
      if (!response.ok) throw new Error('真实驾车路线暂时无法加载。')
      return parseIntroRoute(await response.json())
    } finally { clearTimeout(timeout) }
  })()
  routes.set(coordinates, request)
  request.catch(() => routes.delete(coordinates))
  return request
}
