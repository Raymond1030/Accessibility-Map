import { useEffect, type RefObject } from 'react'
import mapboxgl from 'mapbox-gl'
import { bbox } from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import { useNavigation } from '../state/navigation'
import { useExplore } from './store'
import { selectedPair, useComparison } from '../commute/comparisonStore'
import { useCommute } from '../commute/store'
import { routeFeatures, stationFeatures } from '../commute/transit'
import type { Place } from '../commute/types'
import type { ReachablePoi } from './types'

export function useLifeMap(ref: RefObject<mapboxgl.Map | null>, ready: boolean) {
  const scene = useNavigation(s => s.scene); const e = useExplore(); const c = useComparison()
  const view = useCommute(s => s.view); const homes = useCommute(s => s.homes)
  const exploring = scene === 'explore'
  const comparing = scene === 'commute' && (view === 'move' || (view === 'compare' && c.inspection !== null))
  const profile = e.view === 'profile' ? e.profile : null
  useEffect(() => {
    const map = ref.current
    if (!map || !ready) return
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    if (!map.getSource('life-areas')) {
      map.addSource('life-areas', { type: 'geojson', data: empty })
      map.addLayer({ id: 'life-area-fill', type: 'fill', source: 'life-areas', paint: { 'fill-color': ['get', 'lifeColor'], 'fill-opacity': 0.13 } })
      map.addLayer({ id: 'life-area-border', type: 'line', source: 'life-areas', paint: { 'line-color': ['get', 'lifeColor'], 'line-width': 2 } })
      map.addSource('life-route', { type: 'geojson', data: empty })
      map.addLayer({ id: 'life-route-casing', type: 'line', source: 'life-route', paint: { 'line-color': '#ffffff', 'line-width': 7 } })
      map.addLayer({ id: 'life-route-line', type: 'line', source: 'life-route', filter: ['!=', ['get', 'walking'], true], paint: { 'line-color': ['get', 'color'], 'line-width': 4 } })
      map.addLayer({ id: 'life-route-walk', type: 'line', source: 'life-route', filter: ['==', ['get', 'walking'], true], paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 2] } })
      map.addSource('life-stations', { type: 'geojson', data: empty })
      map.addLayer({ id: 'life-stations-points', type: 'circle', source: 'life-stations', paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'life-stations-labels', type: 'symbol', source: 'life-stations', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#314e85', 'text-halo-color': '#fff', 'text-halo-width': 2 } })
    }
    const { base, target } = selectedPair()
    const pair = [base, target].filter(h => !!h)
    const inspectingOldOrigin = e.selected?.origin && String(e.selected.origin.lngLat) !== String(e.center?.lngLat)
    const profiles = exploring ? (profile && !inspectingOldOrigin ? [profile] : []) : comparing && view === 'move' ? pair.flatMap(h => c.profiles[h.id] ? [c.profiles[h.id]] : []) : []
    const geometry = profiles.flatMap((p, i) => p.geometry ? [{ ...p.geometry, properties: { ...p.geometry.properties, lifeColor: i ? '#80506e' : '#314e85' } }] : [])
    ;(map.getSource('life-areas') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: geometry })
    const route = exploring ? e.selected?.route ?? null : comparing ? c.inspection?.route ?? null : null
    ;(map.getSource('life-route') as mapboxgl.GeoJSONSource).setData(routeFeatures(route))
    ;(map.getSource('life-stations') as mapboxgl.GeoJSONSource).setData(stationFeatures(route))
    if (!exploring && !comparing) return
    const markers: mapboxgl.Marker[] = []; const positions: Place[] = []
    const marker = (place: Place, label: string, kind = '', onClick?: () => void) => {
      const el = document.createElement('button'); el.className = `life-map-marker ${kind}`; el.textContent = label
      el.title = place.name; el.setAttribute('aria-label', place.name)
      el.onclick = event => { event.stopPropagation(); onClick?.() }
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat(place.lngLat).addTo(map)); positions.push(place)
    }
    if (exploring) {
      const origin = e.selected?.origin ?? e.center
      if (origin) marker(origin, '起', 'is-origin')
      const points = new Map<string, ReachablePoi>()
      if (!inspectingOldOrigin) {
        if (profile) Object.values(profile.categories).forEach(r => r?.places.forEach(p => points.set(p.poi.id, p)))
        else e.draw?.places.forEach(p => points.set(p.poi.id, p))
      }
      if (e.selected) points.set(e.selected.poi.id, e.selected)
      let i = 0
      points.forEach(p => marker(p.poi, String(++i), p.poi.id === e.selected?.poi.id ? 'is-selected' : '', () => useExplore.getState().select(p)))
    } else {
      pair.forEach((h, i) => marker(h, i ? '候' : '基', 'is-origin'))
      if (c.inspection) { marker(c.inspection.origin, '起', 'is-origin'); marker(c.inspection.destination, '终', 'is-selected') }
    }
    if (positions.length) {
      const bounds = new mapboxgl.LngLatBounds()
      positions.forEach(p => bounds.extend(p.lngLat)); route?.paths.forEach(path => path.forEach(p => bounds.extend(p)))
      geometry.forEach(g => { const [w, s, e, n] = bbox(g); bounds.extend([w, s]); bounds.extend([e, n]) })
      map.fitBounds(bounds, { padding: { top: 70, right: 45, bottom: window.innerWidth <= 768 ? 120 : 60, left: 45 }, maxZoom: 15, duration: 500 })
    }
    return () => markers.forEach(m => m.remove())
  }, [ref, ready, exploring, comparing, view, profile, e.center, e.selected, e.draw, c.profiles, c.inspection, c.baseId, c.targetId, homes])
}
