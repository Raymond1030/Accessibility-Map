import AMapLoader from '@amap/amap-jsapi-loader'

export class AmapKeyMissingError extends Error {
  constructor() {
    super('未配置高德 Key。请复制 .env.example 为 .env 并填入 VITE_AMAP_KEY。')
    this.name = 'AmapKeyMissingError'
  }
}

let loading: Promise<typeof AMap> | null = null

export function loadAmap(): Promise<typeof AMap> {
  if (loading) return loading

  const key = import.meta.env.VITE_AMAP_KEY
  if (!key) return Promise.reject(new AmapKeyMissingError())

  loading = AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.ArrivalRange', 'AMap.PlaceSearch', 'AMap.Geocoder'],
  })
  return loading
}
