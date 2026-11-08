import { bbox, featureCollection, point, pointOnFeature } from '@turf/turf'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Scene } from '../state/navigation'
import type { Place, Route } from '../commute/types'
import { searchPlaces } from '../amap/search'
import { queryRoute, requests } from '../explore/requests'
import { searchCategory } from '../explore/poi'
import { getProvider } from '../providers'
import { getLocalEngineUrl } from '../providers/local'
import type { IsochroneRequest } from '../providers/cache'
import { intersectAll, simplifyForOps, type PolyFeature } from '../geometry/ops'
import { PLACES } from './story'

type XY = [number, number]
type PreviewPin = { at: XY; text: string; color: string }
export type CasePreview = {
  data: FeatureCollection
  pins: PreviewPin[]
  bounds: [XY, XY]
  readout: { text: string; color: string }[]
  source: string
  notes: string[]
  incomplete: boolean
}
export type PreviewServices = {
  place: (name: string, signal: AbortSignal) => Promise<Place>
  range: (request: IsochroneRequest) => Promise<PolyFeature | null>
  route: typeof queryRoute
  pois: typeof searchCategory
  rangeSource: string
}
// Overlay and map-label colours, aligned with the scene tokens in App.css.
// Commute; mirrors --c-commute.
const BLUE = '#1668e3'
// Meeting / intersection; the violet end of --c-headline, close to --c-meet.
const PURPLE = '#6e56cf'
// Explore card accent; mirrors --c-explore in App.css (no green or yellow text on the landing page).
const CORAL = '#b83e64'
// Second origin (home B in the commute example, "TA" in the meeting example); orange, not yellow.
const ORANGE = '#c8452a'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const minutes = (route: Route) => `${Math.ceil(route.seconds / 60)} 分`
function defaultServices(): PreviewServices {
  return {
    place: (name, signal) => requests.run(`welcome-place:${name}`, async () => {
      const hits = await searchPlaces(name, '深圳')
      if (!hits.length) throw new Error(`未找到${name}`)
      return hits[0]
    }, signal),
    range: req => getProvider(req.mode).fetch(req),
    route: queryRoute,
    pois: searchCategory,
    rangeSource: getLocalEngineUrl() ? '本地路网引擎' : 'Mapbox 路网',
  }
}

/** Only service-returned geometries and durations are rendered. No synthetic fallback. */
export async function loadCasePreview(scene: Scene, signal: AbortSignal, services = defaultServices()): Promise<CasePreview> {
  signal.throwIfAborted()
  const features: Feature<Geometry>[] = []
  const pins: PreviewPin[] = []
  const readout: CasePreview['readout'] = []
  const notes: string[] = []
  let incomplete = false
  const addArea = (shape: PolyFeature, color: string, opacity = .18) => features.push({ ...shape, properties: { color, opacity } })
  const addRoute = (route: Route, color: string) => {
    // A missing path must never become a straight line between the endpoints.
    for (const path of route.paths) if (path.length > 1) features.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: path } })
    if (!route.paths.some(path => path.length > 1)) notes.push('暂时无法显示路线，预计耗时仍可参考。')
  }
  const requireRange = async (request: IsochroneRequest) => {
    const shape = await services.range({ ...request, signal })
    signal.throwIfAborted()
    if (!shape) throw new Error('此位置暂无可达范围数据，请重试。')
    return shape
  }
  let source = ''
  if (scene === 'commute') {
    const office = await services.place('腾讯大厦', signal)
    pins.push({ at: office.lngLat, text: `工作地 · ${office.name}`, color: BLUE })
    const homes = ['大冲新城花园', '南山花园']
    const results = await Promise.allSettled(homes.map(async name => {
      const home = await services.place(name, signal)
      const route = await services.route({ origin: home.lngLat, destination: office.lngLat, city: '深圳', destinationCity: '深圳', mode: 'transit' }, signal)
      return { home, route }
    }))
    signal.throwIfAborted()
    results.forEach((result, i) => {
      const color = i === 0 ? BLUE : ORANGE
      const code = i === 0 ? 'A' : 'B'
      if (result.status === 'rejected') {
        incomplete = true
        readout.push({ text: `${code} · 查询失败`, color })
        notes.push(`${homes[i]}：${message(result.reason)}`)
        return
      }
      const { home, route } = result.value
      pins.push({ at: home.lngLat, text: `${code} · ${home.name}`, color })
      readout.push({ text: `${code} · ${route ? minutes(route) : '无可用路线'}`, color })
      if (route) addRoute(route, color)
    })
    source = '高德公交／地铁路线 · 服务估算耗时'
  } else if (scene === 'isochrone') {
    const ranges = await Promise.all(PLACES.map(place => requireRange({ lngLat: place.lngLat, mode: 'cycling', minutes: 30 })))
    ranges.forEach((shape, i) => {
      const color = i === 0 ? BLUE : ORANGE
      addArea(shape, color)
      pins.push({ at: PLACES[i].lngLat, text: PLACES[i].name, color })
    })
    const common = intersectAll(ranges.map(simplifyForOps))
    if (common) {
      addArea(common, PURPLE, .42)
      pins.push({ at: pointOnFeature(common).geometry.coordinates as XY, text: '共同可达区', color: PURPLE })
    }
    readout.push({ text: '各自骑行 30 分钟', color: BLUE }, { text: common ? '紫色 = 范围交集' : '当前范围暂无交集', color: PURPLE })
    source = `${services.rangeSource} · 骑行等时圈计算交集`
  } else {
    const origin = await services.place('红树湾地铁站', signal)
    const query = { center: origin, city: '深圳', mode: 'walking' as const, minutes: 15 }
    const geometry = await requireRange({ lngLat: origin.lngLat, mode: 'walking', minutes: 15 })
    addArea(geometry, CORAL)
    pins.push({ at: origin.lngLat, text: `出发 · ${origin.name}`, color: CORAL })
    const categories = ['cafe', 'bookstore', 'park'] as const
    // Keep the welcome card light: verify at most three real candidates per category.
    for (const category of categories) {
      signal.throwIfAborted()
      try {
        const found = await services.pois(query, { geometry, nearbyTransit: false }, category, signal)
        for (const poi of found.pois.slice(0, 3)) {
          signal.throwIfAborted()
          try {
            const route = await services.route({ origin: origin.lngLat, destination: poi.lngLat, city: '深圳', destinationCity: poi.city, mode: 'walking' }, signal)
            if (route && route.seconds <= 15 * 60) {
              pins.push({ at: poi.lngLat, text: `${poi.name} · ${minutes(route)}`, color: CORAL })
              addRoute(route, CORAL)
              break
            }
          } catch (error) { signal.throwIfAborted(); incomplete = true; notes.push(message(error)) }
        }
      } catch (error) { signal.throwIfAborted(); incomplete = true; notes.push(message(error)) }
    }
    readout.push({ text: '步行 15 分钟', color: CORAL }, { text: `${pins.length - 1} 个去处`, color: CORAL })
    notes.unshift('更多附近去处，可以进入生活探索查看。')
    source = `${services.rangeSource}范围 · 高德地点与步行耗时`
  }
  signal.throwIfAborted()
  const extent = bbox(featureCollection([...features, ...pins.map(pin => point(pin.at))]))
  return {
    data: { type: 'FeatureCollection', features }, pins, readout, source, notes: [...new Set(notes)], incomplete,
    bounds: [[extent[0], extent[1]], [extent[2], extent[3]]],
  }
}
