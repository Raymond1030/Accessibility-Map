import { loadAmap } from './loader'
import { gcj02ToWgs84 } from '../geo/coord'

/**
 * 高德地名搜索——Mapbox Geocoding 在国内连火车站都只能匹配到城市级，
 * 搜索这一项能力必须借高德。SDK 加载走 loader.ts 的共享入口。
 *
 * 高德返回 GCJ-02，出口统一转成 WGS-84——coord.ts 当初保留正是为了这一天。
 */

export type SearchHit = {
  /** WGS-84，已从高德的 GCJ-02 转换 */
  lngLat: [number, number]
  name: string
}

export async function searchPlace(query: string): Promise<SearchHit> {
  const AMapNS = await loadAmap().catch((err) => {
    throw new Error(`${err instanceof Error ? err.message : err} 搜索不可用，可以点击地图或用定位加点。`)
  })
  const ps = new AMapNS.PlaceSearch({ pageSize: 1 })

  const poi = await new Promise<any>((resolve, reject) => {
    ps.search(query, (status: string, result: any) => {
      if (status === 'complete' && result.poiList?.pois?.length) {
        resolve(result.poiList.pois[0])
        return
      }
      const raw = typeof result === 'string' ? result : result?.info
      if (status === 'error' || (raw && raw !== 'OK')) {
        reject(new Error(`搜索失败：${raw ?? status}`))
      } else {
        reject(new Error('没有找到这个地点'))
      }
    })
  })

  return {
    lngLat: gcj02ToWgs84([poi.location.lng, poi.location.lat]),
    name: poi.name,
  }
}
