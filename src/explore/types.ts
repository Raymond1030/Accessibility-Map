import type { CommuteMode, Place, Route } from '../commute/types'
import type { PolyFeature } from '../geometry/ops'

// AMap official POI taxonomy: https://lbs.amap.com/api/javascript-api/download
export const CATEGORIES = [
  { id: 'mall', type: '060100', label: '商场', keyword: '商场' },
  { id: 'salon', type: '071100', label: '理发', keyword: '美发' },
  { id: 'supermarket', type: '060400', label: '超市', keyword: '超市' },
  { id: 'park', type: '110101', label: '公园', keyword: '公园' },
  { id: 'convenience', type: '060200', label: '便利店', keyword: '便利店' },
  { id: 'food', type: '050000', label: '餐饮', keyword: '餐厅' },
  { id: 'cafe', type: '050500', label: '咖啡', keyword: '咖啡' },
  { id: 'fitness', type: '080111', label: '健身', keyword: '健身' },
  { id: 'pharmacy', type: '090601', label: '药店', keyword: '药店' },
  { id: 'bookstore', type: '061205', label: '书店', keyword: '书店' },
  { id: 'library', type: '140500', label: '图书馆', keyword: '图书馆' },
  { id: 'museum', type: '140100|140200', label: '博物馆／展馆', keyword: '博物馆|展览馆' },
] as const
export type CategoryId = typeof CATEGORIES[number]['id']
export type Weights = Record<CategoryId, number>
export const defaultWeights = (): Weights => Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i < 4 ? 1 : 0])) as Weights
export const categoryLabel = (id: CategoryId) => CATEGORIES.find(c => c.id === id)!.label
export type Poi = Place & { id: string; category: CategoryId; address: string; city: string }
export type ReachablePoi = { poi: Poi; route: Route; origin?: Place }
export type ExploreQuery = { center: Place; city: string; mode: CommuteMode; minutes: number }
export type Discovery = { geometry: PolyFeature | null; nearbyTransit: boolean }
export type CategoryResult = {
  category: CategoryId
  status: 'ok' | 'error'
  places: ReachablePoi[]
  checked: number
  truncated: boolean
  message?: string
}
export type LifeProfile = Discovery & { query: ExploreQuery; categories: Partial<Record<CategoryId, CategoryResult>> }
export const queryKey = (q: ExploreQuery) => JSON.stringify([q.center.lngLat, q.city.trim(), q.mode, q.minutes])
export const enabledCategories = (weights: Weights) => CATEGORIES.filter(c => weights[c.id] > 0).map(c => c.id)
