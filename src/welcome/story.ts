import { distance } from '@turf/turf'
import type { Feature, LineString, Point } from 'geojson'

export const PLACES = [
  { name: '前海湾站', district: '南山', code: 'A', color: '#1668e3', lngLat: [113.893153, 22.540358] as [number, number] },
  { name: '后海站', district: '南山', code: 'B', color: '#c8452a', lngLat: [113.938221, 22.521351] as [number, number] },
]
export const SCENE_DURATIONS = [4200, 5000, 6500, 8000] as const
export type StoryClock = { scene: number; elapsed: number }

/** Pauses preserve this clock; returning from a background tab never skips scenes. */
export function advanceStory(clock: StoryClock, delta: number): StoryClock {
  let scene = clock.scene
  let elapsed = clock.elapsed + Math.max(0, Number.isFinite(delta) ? delta : 0)
  elapsed %= SCENE_DURATIONS.reduce((sum, duration) => sum + duration, 0)
  while (elapsed >= SCENE_DURATIONS[scene]) {
    elapsed -= SCENE_DURATIONS[scene]
    scene = (scene + 1) % SCENE_DURATIONS.length
  }
  return { scene, elapsed }
}

export type MeasuredRoute = {
  coordinates: [number, number][]
  cumulative: number[]
  total: number
}

/** Measure real road segments once. Uneven vertex spacing must not change the travel speed. */
export function measureRoute(coordinates: [number, number][]): MeasuredRoute {
  const cumulative = [0]
  for (let i = 1; i < coordinates.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(coordinates[i - 1], coordinates[i], { units: 'kilometers' }))
  }
  const total = cumulative.at(-1) ?? 0
  if (coordinates.length < 2 || !Number.isFinite(total) || total <= 0) throw new Error('路线缺少有效的道路几何。')
  return { coordinates, cumulative, total }
}

export function routeAtProgress(route: MeasuredRoute, progress: number): {
  line: Feature<LineString>
  point: Feature<Point>
} {
  const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  const target = route.total * fraction
  let low = 1
  let high = route.coordinates.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (route.cumulative[mid] < target) low = mid + 1
    else high = mid
  }
  const index = low
  const segment = route.cumulative[index] - route.cumulative[index - 1]
  const t = segment > 0 ? (target - route.cumulative[index - 1]) / segment : 0
  const start = route.coordinates[index - 1]
  const end = route.coordinates[index]
  const head: [number, number] = fraction === 1 ? route.coordinates.at(-1)! : [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
  return {
    line: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...route.coordinates.slice(0, index), head] } },
    point: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: head } },
  }
}
