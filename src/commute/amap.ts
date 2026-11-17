import { shenzhenRouteLineColor } from '../transit/lineColors'
import { loadAmap } from '../amap/loader'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../geo/coord'
import type { CommuteMode, LngLat, Route, TransitLeg } from './types'
import { TRANSIT_COLORS, WALK_COLOR } from './transit'

// SDK 的响应带有 LngLat 实例，边界处归一化，业务状态只保存普通数据。
type Raw = Record<string, any>
const numeric = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}
function path(points: unknown): LngLat[] {
  if (!Array.isArray(points)) return []
  return points.flatMap((p: any) => {
    const lng = p?.getLng?.() ?? p?.lng ?? p?.[0]
    const lat = p?.getLat?.() ?? p?.lat ?? p?.[1]
    return Number.isFinite(lng) && Number.isFinite(lat)
      ? [gcj02ToWgs84([lng, lat])] : []
  })
}

export function parseRoute(result: Raw, mode: CommuteMode, city?: string): Route | null {
  const candidates: Raw[] = mode === 'transit' ? result.plans : result.routes
  if (!Array.isArray(candidates) || !candidates.length) return null
  const valid = candidates.filter(r => numeric(r.time) !== undefined && numeric(r.distance) !== undefined)
  if (!valid.length) throw new Error('高德返回的路线缺少有效耗时或距离，请重试。')
  const best = [...valid].sort((a, b) => Number(a.time) - Number(b.time))[0]
  const steps: Raw[] = mode === 'transit' ? best.segments ?? [] : best.steps ?? []
  const paths = steps.map(s => path(mode === 'transit' ? s.transit?.path : s.path)).filter(p => p.length > 1)
  // 公交总 path 可能跨越多个交通方式。优先分段绘制，不补造端点之间的直线。
  if (!paths.length && path(best.path).length > 1) paths.push(path(best.path))
  const vehicleLegs = steps.filter(s => s.transit_mode && s.transit_mode !== 'WALK')
  let vehicleIndex = 0
  const transitLegs: TransitLeg[] | undefined = mode === 'transit' ? steps.map(s => {
    const t = s.transit ?? {}
    const legMode = typeof s.transit_mode === 'string' ? s.transit_mode : 'UNKNOWN'
    const lines: string[] = Array.isArray(t.lines)
      ? t.lines.flatMap((line: Raw) => typeof line?.name === 'string' && line.name.trim() ? [line.name.trim()] : []) : []
    if (!lines.length && typeof t.name === 'string' && t.name.trim()) lines.push(t.name.trim())
    const from = t.on_station ?? t.departure_stop
    const to = t.off_station ?? t.arrival_stop
    const fallbackColor = legMode === 'WALK' ? WALK_COLOR : TRANSIT_COLORS[vehicleIndex++ % TRANSIT_COLORS.length]
    return {
      mode: legMode, lines: [...new Set(lines)],
      from: typeof from?.name === 'string' ? from.name : undefined,
      to: typeof to?.name === 'string' ? to.name : undefined,
      fromLocation: path([from?.location])[0], toLocation: path([to?.location])[0],
      viaStops: numeric(t.via_num), meters: numeric(s.distance), seconds: numeric(s.time),
      instruction: typeof s.instruction === 'string' ? s.instruction : undefined,
      path: path(t.path),
      color: shenzhenRouteLineColor(legMode, lines, city) ?? fallbackColor,
    }
  }) : undefined
  return {
    seconds: Number(best.time), meters: Number(best.distance), paths,
    instructions: steps.map(s => s.instruction).filter((s): s is string => typeof s === 'string' && !!s),
    ...(mode === 'transit' ? {
      transitLegs,
      fare: numeric(best.cost), walkingMeters: numeric(best.walking_distance),
      transfers: steps.length ? Math.max(0, vehicleLegs.length - 1) : undefined,
    } : {}),
    fetchedAt: Date.now(),
  }
}

export type RouteRequest = { origin: LngLat; destination: LngLat; city: string; destinationCity: string; mode: CommuteMode }
export function fetchCommuteRoute(request: RouteRequest, timeoutMs = 15000): Promise<Route | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error: Error | null, route: Route | null = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error); else resolve(route)
    }
    const timer = setTimeout(() => finish(new Error('高德路线请求超时，请检查网络、Key 和域名白名单后重试。')), timeoutMs)
    void loadAmap().then(AMap => {
      if (settled) return
      const { mode } = request
      const service = mode === 'transit'
        ? new AMap.Transfer({ city: request.city, cityd: request.destinationCity, policy: AMap.TransferPolicy.LEAST_TIME, extensions: 'all' })
        : mode === 'driving' ? new AMap.Driving({ policy: AMap.DrivingPolicy.LEAST_TIME, extensions: 'all' })
        : mode === 'walking' ? new AMap.Walking() : new AMap.Riding()
      service.search(wgs84ToGcj02(request.origin), wgs84ToGcj02(request.destination), (status: string, result: Raw | string) => {
        if (settled) return
        if (status === 'no_data') { finish(null); return }
        if (status !== 'complete' || typeof result !== 'object' || !result) {
          finish(new Error(`高德路线查询失败：${typeof result === 'string' ? result : result?.info ?? status}`))
          return
        }
        try { finish(null, parseRoute(result, mode, request.city === request.destinationCity ? request.city : undefined)) } catch (error) { finish(error as Error) }
      })
    }).catch(error => finish(error instanceof Error ? error : new Error(String(error))))
  })
}
