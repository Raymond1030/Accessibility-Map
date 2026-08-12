import { useEffect, useState } from 'react'

export const MOBILE_BREAKPOINT = 768

/** 由断点派生，避免 CSS 与 JS 两处各写一个数字后失去同步 */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`

/**
 * 该不该响应地图点击加点。
 *
 * 桌面端一直可以点。移动端必须先进选点模式——手机上拖动地图浏览、
 * 点击收起抽屉都会命中地图，直接加点会持续误触；而每误加一个点
 * 会立刻发出 3 次 ArrivalRange 请求，配额是实打实烧掉的。
 */
export function shouldAddOnMapClick(isMobile: boolean, picking: boolean): boolean {
  return !isMobile || picking
}

/** 监听断点变化——屏幕旋转时要能实时切换形态 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
