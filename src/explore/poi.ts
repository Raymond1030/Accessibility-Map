import { bbox, booleanPointInPolygon, distance, point } from '@turf/turf'
import { loadAmap } from '../amap/loader'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../geo/coord'
import { createMapboxProvider } from '../providers/mapbox'
import { CATEGORIES, type CategoryId, type Discovery, type ExploreQuery, type Poi } from './types'
import { checkSignal, requests } from './requests'

export type PoiPage = { pois: Poi[]; count: number }
export function parsePoiPage(status: string, raw: any, category: CategoryId, city: string): PoiPage {
  if (status === 'no_data') return { pois: [], count: 0 }
  if (status !== 'complete' || !Array.isArray(raw?.poiList?.pois)) throw new Error(`地点查询失败：${typeof raw === 'string' ? raw : raw?.info ?? status}`)
  const pois: Poi[] = raw.poiList.pois.flatMap((p: any) => {
    const lng = p.location?.getLng?.() ?? p.location?.lng
    const lat = p.location?.getLat?.() ?? p.location?.lat
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || typeof p.name !== 'string' || !p.name.trim()) return []
    const lngLat = gcj02ToWgs84([lng, lat])
    return [{ id: typeof p.id === 'string' && p.id ? p.id : `${p.name}:${lngLat.map(v => v.toFixed(6)).join(',')}`,
      name: p.name, lngLat, category, address: typeof p.address === 'string' ? p.address : '',
      city: typeof p.cityname === 'string' && p.cityname ? p.cityname : city }]
  })
  const count = Number(raw.poiList.count)
  return { pois, count: Number.isFinite(count) && count >= 0 ? count : raw.poiList.pois.length }
}

export async function discover(q: ExploreQuery, signal?: AbortSignal): Promise<Discovery> {
  checkSignal(signal)
  // ArrivalRange has been retired in the owning provider. Public transport is
  // discovered with a geographic search, then qualified by directed routes.
  if (q.mode === 'transit') return { geometry: null, nearbyTransit: true }
  // Reuse the provider, with this feature's bounded queue and expiring cache.
  const mode = q.mode
  const geometry = await requests.run(JSON.stringify(['explore-range', q.center.lngLat, q.city.trim(), q.mode, q.minutes]),
    requestSignal => createMapboxProvider().fetch({ lngLat: q.center.lngLat, mode, minutes: q.minutes, signal: requestSignal }), signal)
  checkSignal(signal)
  if (!geometry) throw new Error('此位置暂无可达范围数据，请调整位置或出行方式。')
  return { geometry, nearbyTransit: false }
}

export function filterPois(pois: Poi[], discovery: Discovery, q: ExploreQuery): Poi[] {
  const unique = new Map<string, Poi>()
  for (const p of pois) {
    if (!unique.has(p.id) && (!discovery.geometry || booleanPointInPolygon(point(p.lngLat), discovery.geometry))) unique.set(p.id, p)
  }
  return [...unique.values()].sort((a, b) => distance(q.center.lngLat, a.lngLat) - distance(q.center.lngLat, b.lngLat))
}

export async function searchCategory(q: ExploreQuery, discovery: Discovery, category: CategoryId, signal?: AbortSignal) {
  const all: Poi[] = []
  let truncated = false
  for (let page = 1; page <= 3; page++) {
    checkSignal(signal)
    const key = JSON.stringify(['poi-v2', q.center.lngLat, q.city, q.mode, q.minutes, category, page])
    const result = await requests.run(key, async requestSignal => {
      const AMap = await loadAmap()
      checkSignal(requestSignal)
      const categoryConfig = CATEGORIES.find(c => c.id === category)!
      const search = new AMap.PlaceSearch({ type: categoryConfig.type, city: q.city.trim(), citylimit: true, pageSize: 20, pageIndex: page, extensions: 'all' })
      return new Promise<PoiPage>((resolve, reject) => {
        const callback = (status: string, result: unknown) => {
          try { resolve(parsePoiPage(status, result, category, q.city)) } catch (e) { reject(e) }
        }
        const keyword = category === 'salon' ? categoryConfig.keyword : ''
        if (discovery.geometry) {
          const [west, south, east, north] = bbox(discovery.geometry)
          const bounds = [[west, south], [east, south], [east, north], [west, north]].map(p => wgs84ToGcj02(p as [number, number]))
          search.searchInBounds(keyword, bounds, callback)
        } else search.searchNearBy(keyword, wgs84ToGcj02(q.center.lngLat), 50_000, callback)
      })
    }, signal)
    all.push(...result.pois)
    truncated = result.count > page * 20
    if (!truncated) break
  }
  return { pois: filterPois(all, discovery, q), truncated }
}
