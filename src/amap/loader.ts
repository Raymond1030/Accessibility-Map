import AMapLoader from '@amap/amap-jsapi-loader'

export class AmapKeyMissingError extends Error {
  constructor() {
    super('未配置高德 Key（VITE_AMAP_KEY）。请复制 .env.example 为 .env 并填入。')
    this.name = 'AmapKeyMissingError'
  }
}

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string }
  }
}

/**
 * 高德 JS API 2.0 要求配合安全密钥使用，有两种模式：
 *
 *   代理模式（serviceHost）—— 安全密钥存在代理服务器上，前端只有 Key。生产环境用这个。
 *   明文模式（securityJsCode）—— 密钥直接写在前端。高德官方明确说仅适合开发环境，
 *                                 因为任何人都能从 bundle 里读走它。
 *
 * 两者都配时代理模式优先，避免误把明文密钥带上生产。
 */
function configureSecurity(): void {
  const serviceHost = import.meta.env.VITE_AMAP_SERVICE_HOST
  const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE

  if (serviceHost) {
    window._AMapSecurityConfig = { serviceHost }
    return
  }

  if (securityJsCode) {
    if (import.meta.env.PROD) {
      console.warn(
        '[高德] 正在以明文安全密钥运行生产构建。该密钥对所有访问者可见，' +
        '任何人都能盗用你的配额。生产环境应改用 VITE_AMAP_SERVICE_HOST 代理模式。',
      )
    }
    window._AMapSecurityConfig = { securityJsCode }
  }
}

let loading: Promise<any> | null = null

/**
 * 全应用唯一的 SDK 加载入口——AMapLoader.load 不允许多处以不同插件列表调用，
 * 搜索（PlaceSearch）与到达圈（ArrivalRange）必须共用这一份。
 * SDK 懒加载，首次用到才拉取，不拖累首屏。
 */
export function loadAmap(): Promise<any> {
  if (loading) return loading

  const key = import.meta.env.VITE_AMAP_KEY
  if (!key) return Promise.reject(new AmapKeyMissingError())

  configureSecurity()

  loading = AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.ArrivalRange', 'AMap.PlaceSearch'],
  })
  return loading
}
