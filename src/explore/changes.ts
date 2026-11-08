import type { CategoryId, LifeProfile, ReachablePoi } from './types'
import { checkSignal, queryRoute } from './requests'

export type PoiChanges = { common: ReachablePoi[]; added: ReachablePoi[]; lost: ReachablePoi[]; error?: string }
/** Cross-check the union of both samples: absent from a search page is not unreachable. */
export async function verifyChanges(before: LifeProfile, after: LifeProfile, categories: CategoryId[], signal?: AbortSignal) {
  const results: Partial<Record<CategoryId, PoiChanges>> = {}
  await Promise.all(categories.map(async category => {
    const a = before.categories[category]; const b = after.categories[category]
    if (!a || !b || a.status !== 'ok' || b.status !== 'ok') return
    const changes: PoiChanges = { common: [], added: [], lost: [] }
    const pois = new Map([...a.places, ...b.places].map(p => [p.poi.id, p.poi]))
    for (const poi of pois.values()) {
      checkSignal(signal)
      try {
        const resolve = async (profile: LifeProfile, known: ReachablePoi[]) => {
          const existing = known.find(p => p.poi.id === poi.id)
          if (existing) return existing
          const q = profile.query
          const route = await queryRoute({ origin: q.center.lngLat, destination: poi.lngLat, city: q.city, destinationCity: poi.city, mode: q.mode }, signal)
          return route && route.seconds <= q.minutes * 60 ? { poi, route, origin: q.center } : null
        }
        const [fromBefore, fromAfter] = await Promise.all([resolve(before, a.places), resolve(after, b.places)])
        if (fromBefore && fromAfter) changes.common.push(fromAfter)
        else if (fromAfter) changes.added.push(fromAfter)
        else if (fromBefore) changes.lost.push(fromBefore)
      } catch (e) { checkSignal(signal); changes.error = e instanceof Error ? e.message : String(e) }
    }
    results[category] = changes
  }))
  return results
}
