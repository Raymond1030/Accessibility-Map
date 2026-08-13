import AMapLoader from '@amap/amap-jsapi-loader'
import { gcj02ToWgs84 } from '../geo/coord'

/**
 * 高德地名搜索——Mapbox Geocoding 在国内连火车站都只能匹配到城市级，
 * 搜索这一项能力必须借高德。只加载 PlaceSearch 插件，不建地图；
 * SDK 懒加载，首次搜索才拉取，不拖累首屏。
 *
 * 高德返回 GCJ-02，出口统一转成 WGS-84——coord.ts 当初保留正是为了这一天。
 */

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string }
  }
}

let loading: Promise<any> | null = null

function loadAmapSearch(): Promise<any> {
  if (loading) return loading

  const key = import.meta.env.VITE_AMAP_KEY
  if (!key) {
    return Promise.reject(new Error('未配置高德 Key（VITE_AMAP_KEY），搜索不可用。可以点击地图或用定位加点。'))
  }

  const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE
  if (securityJsCode) window._AMapSecurityConfig = { securityJsCode }

  loading = AMapLoader.load({ key, version: '2.0', plugins: ['AMap.PlaceSearch'] })
  return loading
}

export type SearchHit = {
  /** WGS-84，已从高德的 GCJ-02 转换 */
  lngLat: [number, number]
  name: string
}

export async function searchPlace(query: string): Promise<SearchHit> {
  const AMapNS = await loadAmapSearch()
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
