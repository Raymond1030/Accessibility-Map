import { loadAmap } from './loader'
import { gcj02ToWgs84 } from '../geo/coord'

export type SearchHit = {
  /** WGS-84，已从高德的 GCJ-02 转换 */
  lngLat: [number, number]
  name: string
  address?: string
}

export function searchPlaces(query: string, city?: string): Promise<SearchHit[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error: Error | null, hits: SearchHit[] = []) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error); else resolve(hits)
    }
    const timer = setTimeout(() => finish(new Error('地点搜索超时，请检查高德配置或在地图选点。')), 15000)
    void loadAmap().then(AMap => {
      if (settled) return
      const ps = new AMap.PlaceSearch({ pageSize: 5, ...(city ? { city, citylimit: true } : {}) })
      ps.search(query, (status: string, result: any) => {
        if (status === 'complete' && result.poiList?.pois?.length) {
          const hits = result.poiList.pois.filter((p: any) => Number.isFinite(p.location?.lng) && Number.isFinite(p.location?.lat))
            .map((p: any) => ({ lngLat: gcj02ToWgs84([p.location.lng, p.location.lat]), name: p.name,
              address: [p.cityname, p.adname, typeof p.address === 'string' ? p.address : ''].filter(Boolean).join(' ') }))
          finish(null, hits)
        } else {
          const raw = typeof result === 'string' ? result : result?.info
          finish(new Error(status === 'error' ? `搜索失败：${raw ?? status}` : '没有找到这个地点，请补充城市或街道。'))
        }
      })
    }).catch(error => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

export async function searchPlace(query: string): Promise<SearchHit> {
  const hits = await searchPlaces(query)
  if (!hits.length) throw new Error('没有找到这个地点')
  return hits[0]
}
