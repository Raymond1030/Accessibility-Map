import { discover, searchCategory } from './poi'
import { checkSignal, queryRoute } from './requests'
import type { CategoryId, ExploreQuery, Poi, ReachablePoi } from './types'

export function shuffled<T>(items: T[], random = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
export type DrawResult = { places: ReachablePoi[]; errors: string[]; exhausted: boolean; checked: number }
export async function drawPlaces(q: ExploreQuery, categories: CategoryId[], excluded: Set<string>, signal?: AbortSignal): Promise<DrawResult> {
  const discovery = await discover(q, signal)
  const candidates = new Map<string, Poi>(); const errors: string[] = []
  await Promise.all(categories.map(async category => {
    try {
      const pool = await searchCategory(q, discovery, category, signal)
      pool.pois.forEach(p => { if (!excluded.has(p.id)) candidates.set(p.id, p) })
    } catch (error) { checkSignal(signal); errors.push(error instanceof Error ? error.message : String(error)) }
  }))
  const pool = shuffled([...candidates.values()]); const places: ReachablePoi[] = []
  let checked = 0
  for (const poi of pool.slice(0, 12)) {
    checkSignal(signal)
    checked++
    try {
      const route = await queryRoute({ origin: q.center.lngLat, destination: poi.lngLat, city: q.city, destinationCity: poi.city, mode: q.mode }, signal)
      if (route && route.seconds <= q.minutes * 60) places.push({ poi, route, origin: q.center })
    } catch (error) { checkSignal(signal); errors.push(error instanceof Error ? error.message : String(error)) }
    if (places.length === 3) break
  }
  return { places, errors, checked, exhausted: pool.length <= checked && places.length < 3 && !errors.length }
}
