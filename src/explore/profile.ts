import type { CategoryId, CategoryResult, ExploreQuery, LifeProfile, ReachablePoi, Weights } from './types'
import { discover, searchCategory } from './poi'
import { checkSignal, queryRoute } from './requests'

export const categoryScore = (r: CategoryResult | undefined, minutes: number): number | null => {
  if (!r || r.status === 'error') return null
  if (!r.places.length) return 0
  const nearest = Math.min(...r.places.map(p => p.route.seconds))
  return 100 * (0.5 * Math.min(r.places.length / 3, 1) + 0.5 * Math.max(0, 1 - nearest / (minutes * 60)))
}
export function profileScore(profile: LifeProfile | null, weights: Weights): number | null {
  if (!profile) return null
  let sum = 0; let total = 0
  for (const [id, weight] of Object.entries(weights)) {
    if (weight <= 0) continue
    const score = categoryScore(profile.categories[id as CategoryId], profile.query.minutes)
    if (score === null) return null
    sum += score * weight; total += weight
  }
  return total ? sum / total : null
}

export async function buildProfile(q: ExploreQuery, categories: CategoryId[], signal?: AbortSignal, onProgress?: (p: LifeProfile) => void): Promise<LifeProfile> {
  const discovery = await discover(q, signal)
  const profile: LifeProfile = { ...discovery, query: q, categories: {} }
  onProgress?.({ ...profile })
  await Promise.all(categories.map(async category => {
    const places: ReachablePoi[] = []
    let checked = 0; let truncated = false; const errors: string[] = []
    try {
      const pool = await searchCategory(q, discovery, category, signal)
      truncated = pool.truncated || pool.pois.length > 5
      for (const poi of pool.pois.slice(0, 5)) {
        checkSignal(signal)
        try {
          const route = await queryRoute({ origin: q.center.lngLat, destination: poi.lngLat, city: q.city, destinationCity: poi.city, mode: q.mode }, signal)
          checked++
          if (route && route.seconds <= q.minutes * 60) places.push({ poi, route, origin: q.center })
        } catch (error) { checkSignal(signal); errors.push(error instanceof Error ? error.message : String(error)) }
      }
    } catch (error) { checkSignal(signal); errors.push(error instanceof Error ? error.message : String(error)) }
    profile.categories[category] = { category, status: errors.length ? 'error' : 'ok', places: places.sort((a, b) => a.route.seconds - b.route.seconds), checked, truncated,
      ...(errors.length ? { message: `${errors.length} 项查询未完成：${errors[0]}` } : {}) }
    checkSignal(signal)
    onProgress?.({ ...profile, categories: { ...profile.categories } })
  }))
  return profile
}

export function comparePois(before: CategoryResult | undefined, after: CategoryResult | undefined) {
  if (!before || !after || before.status !== 'ok' || after.status !== 'ok') return null
  const a = new Set(before.places.map(p => p.poi.id)); const b = new Set(after.places.map(p => p.poi.id))
  return { common: after.places.filter(p => a.has(p.poi.id)), added: after.places.filter(p => !a.has(p.poi.id)), lost: before.places.filter(p => !b.has(p.poi.id)) }
}
