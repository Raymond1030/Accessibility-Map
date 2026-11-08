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
import { categoryLabel, type Poi, type ReachablePoi } from './types'
import { categoryIcon } from './categoryIcons'
import { withOverlayInsets } from '../ui/mapInsets'
import { RANGE_DASH } from '../ui/mapStyle'
import { markerIconSrc } from '../ui/markerIcons'
import { createPlaceMarkerElement, type PlaceMarkerOptions } from '../ui/placeMarker'

// 搬家对比时两处住处的生活圈填色；住处标记的圆牌用同一颜色，地图上一眼对得上
const BASE_LIFE_COLOR = '#36658a'
const CANDIDATE_LIFE_COLOR = '#a8476a'

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
      map.addLayer({ id: 'life-area-border', type: 'line', source: 'life-areas', paint: { 'line-color': ['get', 'lifeColor'], 'line-width': 2, 'line-dasharray': RANGE_DASH } })
      map.addSource('life-route', { type: 'geojson', data: empty })
      map.addLayer({ id: 'life-route-casing', type: 'line', source: 'life-route', paint: { 'line-color': '#ffffff', 'line-width': 7 } })
      map.addLayer({ id: 'life-route-line', type: 'line', source: 'life-route', filter: ['!=', ['get', 'walking'], true], paint: { 'line-color': ['get', 'color'], 'line-width': 4 } })
      map.addLayer({ id: 'life-route-walk', type: 'line', source: 'life-route', filter: ['==', ['get', 'walking'], true], paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 2] } })
      map.addSource('life-stations', { type: 'geojson', data: empty })
      map.addLayer({ id: 'life-stations-points', type: 'circle', source: 'life-stations', paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'life-stations-labels', type: 'symbol', source: 'life-stations', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#2c4253', 'text-halo-color': '#fff', 'text-halo-width': 2 } })
    }
    const { base, target } = selectedPair()
    const pair = [base, target].filter(h => !!h)
    const inspectingOldOrigin = e.selected?.origin && String(e.selected.origin.lngLat) !== String(e.center?.lngLat)
    const profiles = exploring ? (profile && !inspectingOldOrigin ? [profile] : []) : comparing && view === 'move' ? pair.flatMap(h => c.profiles[h.id] ? [c.profiles[h.id]] : []) : []
    const geometry = profiles.flatMap((p, i) => p.geometry ? [{ ...p.geometry, properties: { ...p.geometry.properties, lifeColor: i ? CANDIDATE_LIFE_COLOR : BASE_LIFE_COLOR } }] : [])
    ;(map.getSource('life-areas') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: geometry })
    const route = exploring ? e.selected?.route ?? null : comparing ? c.inspection?.route ?? null : null
    ;(map.getSource('life-route') as mapboxgl.GeoJSONSource).setData(routeFeatures(route))
    ;(map.getSource('life-stations') as mapboxgl.GeoJSONSource).setData(stationFeatures(route))
    if (!exploring && !comparing) return
    const markers: mapboxgl.Marker[] = []; const positions: Place[] = []
    // 地点标记与「多点见面」同一造型：白底方块＋彩色类型图标＋编号圆牌（见 ui/placeMarker）
    const marker = (place: Place, options: Omit<PlaceMarkerOptions, 'title' | 'label'> & { label?: string }) => {
      const el = createPlaceMarkerElement({ ...options, title: place.name, label: options.label ?? place.name })
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat(place.lngLat).addTo(map)); positions.push(place)
    }
    if (exploring) {
      const origin = e.selected?.origin ?? e.center
      if (origin) marker(origin, { text: '起', tone: 'brand', large: true, label: `起点：${origin.name}` })
      const points = new Map<string, ReachablePoi>()
      if (!inspectingOldOrigin) {
        if (profile) Object.values(profile.categories).forEach(r => r?.places.forEach(p => points.set(p.poi.id, p)))
        else e.draw?.places.forEach(p => points.set(p.poi.id, p))
      }
      if (e.selected) points.set(e.selected.poi.id, e.selected)
      let i = 0
      points.forEach(p => {
        const n = String(++i)
        const selected = p.poi.id === e.selected?.poi.id
        const icon = categoryIcon(p.poi.category)
        marker(p.poi, {
          // 认得的类别画彩色图标、编号放圆牌；旧缓存里不认识的类别退回只写编号
          ...(icon ? { icon, chip: n } : { text: n }),
          tone: selected ? 'result' : 'explore',
          selected,
          label: icon ? `${n}. ${categoryLabel(p.poi.category)}：${p.poi.name}` : `${n}. ${p.poi.name}`,
          onClick: () => useExplore.getState().select(p),
        })
      })
    } else {
      pair.forEach((h, i) => marker(h, {
        icon: markerIconSrc('home'),
        chip: i ? '候' : '基',
        tone: 'brand',
        color: i ? CANDIDATE_LIFE_COLOR : BASE_LIFE_COLOR,
        large: true,
        label: `${i ? '候选住处' : '基准住处'}：${h.name}`,
      }))
      if (c.inspection) {
        const { origin, destination } = c.inspection
        marker(origin, { text: '起', tone: 'brand', large: true, label: `起点：${origin.name}` })
        const icon = categoryIcon((destination as Partial<Poi>).category)
        marker(destination, { ...(icon ? { icon, chip: '终' } : { text: '终' }), tone: 'result', selected: true, label: `终点：${destination.name}` })
      }
    }
    if (positions.length) {
      const bounds = new mapboxgl.LngLatBounds()
      positions.forEach(p => bounds.extend(p.lngLat)); route?.paths.forEach(path => path.forEach(p => bounds.extend(p)))
      geometry.forEach(g => { const [w, s, e, n] = bbox(g); bounds.extend([w, s]); bounds.extend([e, n]) })
      map.fitBounds(bounds, { padding: withOverlayInsets({ top: 70, right: 45, bottom: window.innerWidth <= 768 ? 120 : 60, left: 45 }), maxZoom: 15, duration: 500 })
    }
    return () => markers.forEach(m => m.remove())
  }, [ref, ready, exploring, comparing, view, profile, e.center, e.selected, e.draw, c.profiles, c.inspection, c.baseId, c.targetId, homes])
}
