import { metroRangeInfo } from '../providers/metroWalking'
import { metroMapFeatures } from '../transit/mapFeatures'
import type { MetroNetwork } from '../transit/types'
import shenzhenMetro from '../data/metro/shenzhen.json'
import { useEffect, type RefObject } from 'react'
import mapboxgl from 'mapbox-gl'
import { useCommute } from './store'
import { routeKey } from './types'
import { routeFeatures, stationFeatures } from './transit'
import { bbox } from '@turf/turf'
import { RANGE_COLORS } from './range'
import { markerIconMarkup } from '../ui/markerIcons'
import { useNavigation } from '../state/navigation'
import { useComparison } from './comparisonStore'

export function useCommuteMap(mapRef: RefObject<mapboxgl.Map | null>, ready: boolean) {
  const { view, workplace, homes, selectedId, mode, cells, rangeMode, rangeResult } = useCommute()
  const scene = useNavigation(s => s.scene)
  const inspecting = useComparison(s => s.inspection !== null)
  const active = scene === 'commute' && view !== 'move' && !(view === 'compare' && inspecting)
  const selectedCell = selectedId ? cells[routeKey(selectedId, mode)] : undefined
  const route = view === 'compare' && selectedCell?.status === 'ok' ? selectedCell.route : null
  const rangeGeometry = view === 'range' && rangeResult.status === 'ok' ? rangeResult.geometry : null
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getSource('origin-points')) return
    for (const id of ['origins-fill', 'origins-line', 'result-fill', 'result-casing', 'result-line', 'origin-point-hit', 'origin-symbols']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', scene === 'isochrone' ? 'visible' : 'none')
    }
    if (!map.getSource('workplace-range')) {
      map.addSource('workplace-range', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'workplace-range-fill', type: 'fill', source: 'workplace-range', paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.21 } })
      map.addLayer({ id: 'workplace-range-outline', type: 'line', source: 'workplace-range', paint: { 'line-color': '#ffffff', 'line-width': 5 } })
      map.addLayer({ id: 'workplace-range-border', type: 'line', source: 'workplace-range', paint: { 'line-color': '#7c3aed', 'line-width': 2.5 } })
    }
    ;(map.getSource('workplace-range') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: active && rangeGeometry ? [rangeGeometry] : [] })
    map.setPaintProperty('workplace-range-fill', 'fill-color', RANGE_COLORS[rangeMode])
    map.setPaintProperty('workplace-range-border', 'line-color', RANGE_COLORS[rangeMode])
    if (!map.getSource('range-metro-network')) {
      map.addSource('range-metro-network', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'range-metro-lines', type: 'line', source: 'range-metro-network',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [3, 2] } })
      map.addLayer({ id: 'range-metro-stations', type: 'circle', source: 'range-metro-network',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'range-metro-labels', type: 'symbol', source: 'range-metro-network', minzoom: 11,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 } })
    }
    map.setPaintProperty('range-metro-lines', 'line-color', ['get', 'color'])
    map.setPaintProperty('range-metro-stations', 'circle-stroke-color', ['get', 'color'])
    map.setPaintProperty('range-metro-labels', 'text-color', ['get', 'color'])
    ;(map.getSource('range-metro-network') as mapboxgl.GeoJSONSource).setData(
      metroMapFeatures(active ? metroRangeInfo(rangeGeometry) : null, shenzhenMetro as unknown as MetroNetwork))
    if (!map.getSource('commute-route')) {
      map.addSource('commute-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'commute-route-outline', type: 'line', source: 'commute-route', paint: { 'line-color': '#ffffff', 'line-width': 8 } })
      map.addLayer({ id: 'commute-route-line', type: 'line', source: 'commute-route', paint: { 'line-color': '#5138c9', 'line-width': 4 } })
    }
    map.setFilter('commute-route-line', ['!=', ['get', 'walking'], true])
    map.setPaintProperty('commute-route-line', 'line-color', ['get', 'color'])
    if (!map.getLayer('commute-walk-line')) {
      map.addLayer({ id: 'commute-walk-line', type: 'line', source: 'commute-route',
        filter: ['==', ['get', 'walking'], true],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 2] } })
      map.addLayer({ id: 'commute-line-labels', type: 'symbol', source: 'commute-route',
        filter: ['all', ['!=', ['get', 'walking'], true], ['!=', ['get', 'label'], '']],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-size': 12, 'symbol-spacing': 220 },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 } })
      map.addSource('commute-stations', { type: 'geojson', data: stationFeatures(null) })
      map.addLayer({ id: 'commute-station-points', type: 'circle', source: 'commute-stations',
        paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'commute-station-labels', type: 'symbol', source: 'commute-stations',
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
        paint: { 'text-color': '#17233b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } })
    }
    ;(map.getSource('commute-route') as mapboxgl.GeoJSONSource).setData(routeFeatures(active ? route : null))
    ;(map.getSource('commute-stations') as mapboxgl.GeoJSONSource).setData(stationFeatures(active ? route : null))
    if (!active) return
    const markers: mapboxgl.Marker[] = []
    const points = [
      ...(workplace ? [{ ...workplace, id: 'work', text: '' }] : []),
      ...(view === 'compare' ? homes.map((home, i) => ({ ...home, text: String(i + 1) })) : []),
    ]
    for (const place of points) {
      const el = document.createElement('button')
      el.className = `commute-marker${place.id !== 'work' ? ' home' : ''}${place.id === selectedId ? ' selected' : ''}`
      const isWorkplace = place.id === 'work'
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markerIconMarkup(isWorkplace ? 'work' : 'home')}</svg>`
      if (!isWorkplace) {
        const number = document.createElement('span')
        number.className = 'commute-marker-number'
        number.textContent = place.text
        el.appendChild(number)
      }
      el.title = place.name
      el.setAttribute('aria-label', `${isWorkplace ? '公司' : `候选住处 ${place.text}`}：${place.name}`)
      el.onclick = event => { event.stopPropagation(); if (place.id !== 'work') useCommute.getState().select(place.id) }
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat(place.lngLat).addTo(map))
    }
    if (points.length) {
      const bounds = new mapboxgl.LngLatBounds()
      points.forEach(p => bounds.extend(p.lngLat))
      route?.paths.forEach(path => path.forEach(p => bounds.extend(p)))
      if (rangeGeometry) {
        const [west, south, east, north] = bbox(rangeGeometry)
        bounds.extend([west, south]); bounds.extend([east, north])
      }
      map.fitBounds(bounds, { padding: { top: 70, right: 60, bottom: window.innerWidth <= 768 ? 120 : 70, left: 60 }, maxZoom: 14, duration: 500 })
    }
    return () => markers.forEach(marker => marker.remove())
  }, [mapRef, ready, active, scene, view, workplace, homes, selectedId, route, rangeGeometry, rangeMode])
}
