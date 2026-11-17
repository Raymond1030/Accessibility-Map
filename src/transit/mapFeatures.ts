import { metroLineColor, metroLineLabel, METRO_NEUTRAL_COLOR } from './lineColors'
import type { FeatureCollection, LineString, Point } from 'geojson'
import type { MetroNetwork } from './types'
import type { MetroRangeInfo } from '../providers/metroWalking'

/** 站间连线仅为拓扑示意，不冒充真实轨道轨迹。 */
export function metroMapFeatures(info: MetroRangeInfo | null, network: MetroNetwork): FeatureCollection<LineString | Point> {
  const features: FeatureCollection<LineString | Point>['features'] = []
  if (!info) return { type: 'FeatureCollection', features }
  const reached = new Set(info.stations.map(station => station.id))
  const atPlace = new Map<string, { name: string; lngLat: [number, number]; lines: Set<string> }>()
  for (const station of info.stations) {
    const key = station.lngLat.join(',')
    const prev = atPlace.get(key) ?? { ...station, lines: new Set<string>() }
    prev.lines.add(station.line)
    atPlace.set(key, prev)
  }
  for (const station of atPlace.values()) features.push({
    type: 'Feature', properties: { name: `${station.name} · ${[...station.lines].map(metroLineLabel).join('/')}`,
      color: station.lines.size === 1 ? metroLineColor([...station.lines][0], network.city) : METRO_NEUTRAL_COLOR },
    geometry: { type: 'Point', coordinates: station.lngLat },
  })
  for (const line of network.lines) {
    for (let i = 1; i < line.stations.length; i++) {
      const a = line.stations[i - 1]; const b = line.stations[i]
      if (!reached.has(a.id) || !reached.has(b.id)) continue
      features.push({ type: 'Feature', properties: { name: metroLineLabel(line.id), color: metroLineColor(line.id, network.city) },
        geometry: { type: 'LineString', coordinates: [a.lngLat, b.lngLat] } })
    }
  }
  return { type: 'FeatureCollection', features }
}
