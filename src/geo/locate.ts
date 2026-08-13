export const GEO_UNSUPPORTED = '这个浏览器不支持定位，请用搜索加点。'

/**
 * 把 GeolocationPositionError 翻译成能照着做的中文。
 *
 * 每一类都必须给出补救路径——定位失败在手机上很常见，
 * 只说「定位失败」会让人卡在那里不知道还能干什么。
 */
export function describeGeolocationError(err: { code: number; message: string }): string {
  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return '定位权限被拒绝。可在浏览器设置里重新允许，或直接搜索地点加点。'
    case 2: // POSITION_UNAVAILABLE
      return '拿不到位置信号，室内或信号弱时常见。可以改用搜索加点。'
    case 3: // TIMEOUT
      return '定位超时，可以再试一次，或改用搜索加点。'
    default:
      return `定位失败${err.message ? `：${err.message}` : ''}。可以改用搜索加点。`
  }
}

export type LocateResult = {
  /** WGS-84——浏览器原生坐标系，与 Mapbox 一致，无需转换 */
  lngLat: [number, number]
  /** 定位精度，米 */
  accuracy: number
}

/**
 * 取当前位置。浏览器与 Mapbox 都是 WGS-84，直接透传。
 * （高德时代这里要过一道 wgs84ToGcj02，迁移后那是反向错误。）
 */
export function locateCurrentPosition(): Promise<LocateResult> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error(GEO_UNSUPPORTED))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lngLat: [pos.coords.longitude, pos.coords.latitude],
          accuracy: pos.coords.accuracy,
        })
      },
      (err) => reject(new Error(describeGeolocationError(err))),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  })
}
