import type { CommuteMode, Place, Route } from './types'
import { checkSignal, queryRoute } from '../explore/requests'

export type Visit = { id: string; place: Place; city: string; mode: CommuteMode; weekly: number }
export type RoundTrip = { out: Route | null; back: Route | null; errors: string[] }
export async function roundTrip(home: Place, city: string, visit: Visit, signal?: AbortSignal): Promise<RoundTrip> {
  const errors: string[] = []
  const query = async (origin: Place, destination: Place, fromCity: string, toCity: string) => {
    try { return await queryRoute({ origin: origin.lngLat, destination: destination.lngLat, city: fromCity, destinationCity: toCity, mode: visit.mode }, signal) }
    catch (e) { checkSignal(signal); errors.push(e instanceof Error ? e.message : String(e)); return null }
  }
  const [out, back] = await Promise.all([query(home, visit.place, city, visit.city), query(visit.place, home, visit.city, city)])
  return { out, back, errors }
}
export const tripSeconds = (trip?: RoundTrip) => trip?.out && trip.back ? trip.out.seconds + trip.back.seconds : null
export function rentComparison(baseRent: number | null, rent: number | null, before: RoundTrip | undefined, after: RoundTrip | undefined, days: number) {
  const a = tripSeconds(before); const b = tripSeconds(after)
  const hours = a === null || b === null ? null : (a - b) * days / 3600
  const delta = baseRent === null || rent === null ? null : rent - baseRent
  let verdict = '等待租金和双向路线'
  if (hours !== null && delta !== null) {
    verdict = hours > 0 ? (delta > 0 ? '多付租金，换回时间' : delta < 0 ? '更便宜，也更省时' : '同样租金，更省时')
      : hours < 0 ? (delta > 0 ? '更贵，也更费时' : delta < 0 ? '省下租金，多花时间' : '同样租金，更费时')
        : delta > 0 ? '租金更高，通勤时间相同' : delta < 0 ? '租金更低，通勤时间相同' : '租金和通勤时间相同'
  }
  return { hours, delta, verdict, price: hours !== null && hours > 0 && delta !== null && delta > 0 ? delta / hours : null }
}
export function weeklyTotal(visits: Visit[], trips: Record<string, RoundTrip>) {
  let seconds = 0; const missing: string[] = []
  for (const v of visits.filter(v => v.weekly > 0)) {
    const trip = trips[v.id]
    for (const direction of ['out', 'back'] as const) {
      const route = trip?.[direction]
      if (route) seconds += route.seconds * v.weekly
      else missing.push(`${v.place.name}（${direction === 'out' ? '去程' : '回程'}）`)
    }
  }
  return { seconds, missing, complete: !missing.length }
}
