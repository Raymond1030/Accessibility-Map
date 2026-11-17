export type LngLat = [number, number]
export const COMMUTE_MODES = ['transit', 'driving', 'walking', 'cycling'] as const
export type CommuteMode = typeof COMMUTE_MODES[number]
export const COMMUTE_LABELS: Record<CommuteMode, string> = {
  transit: '公交 / 地铁', driving: '驾车', walking: '步行', cycling: '骑行',
}
export type Place = { name: string; lngLat: LngLat }
export type Home = Place & { id: string; rent: number | null }
export type TransitLeg = {
  mode: string
  lines: string[]
  from?: string
  to?: string
  fromLocation?: LngLat
  toLocation?: LngLat
  viaStops?: number
  meters?: number
  seconds?: number
  instruction?: string
  path: LngLat[]
  color: string
}
export type Route = {
  seconds: number
  meters: number
  fare?: number
  walkingMeters?: number
  transfers?: number
  instructions: string[]
  paths: LngLat[][]
  transitLegs?: TransitLeg[]
  fetchedAt: number
}
export type RouteCell =
  | { status: 'loading' }
  | { status: 'ok'; route: Route }
  | { status: 'empty' }
  | { status: 'error'; message: string }
export const routeKey = (id: string, mode: CommuteMode) => `${id}:${mode}`

export function eligibility(home: Home, cell: RouteCell | undefined, minutes: number, budget: number | null) {
  if (budget !== null && home.rent === null) return '待填租金'
  if (budget !== null && home.rent !== null && home.rent > budget) return '超出预算'
  if (!cell || cell.status === 'loading') return '待评估'
  if (cell.status === 'error') return '数据不全'
  if (cell.status === 'empty') return '无可用路线'
  return cell.route.seconds <= minutes * 60 ? '符合条件' : '通勤超时'
}
