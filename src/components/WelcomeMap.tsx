import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { bbox } from '@turf/turf'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getMapboxToken } from '../mapbox/token'
import { getProvider } from '../providers'
import { intersectAll, simplifyForOps, type PolyFeature } from '../geometry/ops'
import { loadIntroRoute, type IntroRoute } from '../welcome/directions'
import { advanceStory, PLACES, routeAtProgress, SCENE_DURATIONS, type StoryClock } from '../welcome/story'
import type { FeatureCollection } from 'geojson'
import './WelcomeMap.css'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const SCENES = ['从南山出发', '沿着真实道路，去福田', '半小时的生活半径', '找到共同的生活圈']
const ROUTE_COLOR = '#64e0bc'
type LoadState = 'loading' | 'ready' | 'error'
type Camera = { center: [number, number]; zoom: number; pitch: number; bearing: number }
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t) }

export function WelcomeMap() {
  const frame = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const [mapState, setMapState] = useState<LoadState>('loading')
  const [rangeState, setRangeState] = useState<LoadState | 'empty'>('loading')
  const [routeState, setRouteState] = useState<LoadState>('loading')
  const [ranges, setRanges] = useState<PolyFeature[]>([])
  const [route, setRoute] = useState<IntroRoute | null>(null)
  const [paused, setPaused] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [revision, setRevision] = useState(0)
  const [sizeRevision, setSizeRevision] = useState(0)
  const [clock, setClock] = useState<StoryClock>({ scene: 0, elapsed: 0 })
  const clockRef = useRef(clock)
  const cameraRef = useRef<{ key: string; from: Camera; to: Camera } | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const scene = clock.scene
  const progress = clock.elapsed / SCENE_DURATIONS[scene]
  const routeProgress = reducedMotion ? 1 : smooth((progress - .12) / .76)
  const waiting = (scene === 1 && routeState === 'loading') || (scene >= 2 && rangeState === 'loading')
  const playing = visible && pageVisible && !paused && mapState === 'ready'

  const commonRange = useMemo(() => {
    if (ranges.length !== 2) return null
    try { return intersectAll(ranges) } catch { return null }
  }, [ranges])

  useEffect(() => {
    if (!frame.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .1 })
    observer.observe(frame.current)
    const onVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = () => setReducedMotion(media.matches)
    media.addEventListener('change', onMotion)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      media.removeEventListener('change', onMotion)
    }
  }, [])

  useEffect(() => {
    if (!container.current) return
    let disposed = false
    let map: mapboxgl.Map
    const markers: mapboxgl.Marker[] = []
    cameraRef.current = null
    setMapState('loading')
    setRangeState('loading')
    setRouteState('loading')
    setRanges([])
    setRoute(null)
    try {
      map = new mapboxgl.Map({
        container: container.current,
        accessToken: getMapboxToken(),
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [113.995, 22.54], zoom: 11.4, pitch: 28, bearing: -12,
        interactive: false, attributionControl: false,
      })
    } catch { setMapState('error'); return }
    mapRef.current = map
    map.addControl(new mapboxgl.AttributionControl({ compact: true }))
    map.getCanvas().setAttribute('tabindex', '-1')
    map.getCanvas().setAttribute('aria-label', '南山高新园至福田购物公园，真实驾车路线与可达范围动画')
    const deadline = window.setTimeout(() => { if (!disposed) setMapState('error') }, 25000)
    map.on('load', () => {
      if (disposed) return
      window.clearTimeout(deadline)
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type === 'symbol' && layer.layout?.['text-field']) {
          map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name_zh-Hans'], ['get', 'name_zh-Hant'], ['get', 'name']])
        }
      }
      const labelLayer = map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id
      map.addSource('welcome-ranges', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'welcome-fill', type: 'fill', source: 'welcome-ranges', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'], 'fill-opacity-transition': { duration: 0 } } }, labelLayer)
      map.addLayer({ id: 'welcome-line', type: 'line', source: 'welcome-ranges', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': .65 } }, labelLayer)
      for (const id of ['welcome-route-base', 'welcome-route', 'welcome-traveler']) map.addSource(id, { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'welcome-route-base-line', type: 'line', source: 'welcome-route-base', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ROUTE_COLOR, 'line-width': 2, 'line-opacity': .18 } })
      map.addLayer({ id: 'welcome-route-glow', type: 'line', source: 'welcome-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ROUTE_COLOR, 'line-width': 10, 'line-blur': 6, 'line-opacity': .28 } })
      map.addLayer({ id: 'welcome-route-line', type: 'line', source: 'welcome-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ROUTE_COLOR, 'line-width': 3.5 } })
      map.addLayer({ id: 'welcome-traveler-halo', type: 'circle', source: 'welcome-traveler', paint: { 'circle-radius': 17, 'circle-color': ROUTE_COLOR, 'circle-opacity': .24, 'circle-blur': .5 } })
      map.addLayer({ id: 'welcome-traveler-dot', type: 'circle', source: 'welcome-traveler', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ROUTE_COLOR, 'circle-stroke-width': 2 } })
      PLACES.forEach((place, i) => {
        const element = document.createElement('div')
        element.className = `welcome-place welcome-place-${i}`
        element.style.setProperty('--place-color', place.color)
        const dot = document.createElement('span')
        dot.textContent = place.code
        const label = document.createElement('strong')
        label.textContent = `${place.district} · ${place.name}`
        element.append(dot, label)
        markers.push(new mapboxgl.Marker({ element, anchor: 'center' }).setLngLat(place.lngLat).addTo(map))
      })
      setMapState('ready')
      void loadIntroRoute(PLACES[0].lngLat, PLACES[1].lngLat).then(result => {
        if (!disposed) { setRoute(result); setRouteState('ready') }
      }).catch(() => { if (!disposed) setRouteState('error') })
      const provider = getProvider('driving')
      void Promise.all(PLACES.map(place => provider.fetch({ lngLat: place.lngLat, mode: 'driving', minutes: 30 }))).then(results => {
        if (disposed) return
        if (results.some(result => !result)) { setRangeState('empty'); return }
        setRanges(results.map(result => simplifyForOps(result!)))
        setRangeState('ready')
      }).catch(() => { if (!disposed) setRangeState('error') })
    })
    map.on('error', event => {
      if (!disposed && /401|403|Unauthorized|Forbidden/i.test(event.error?.message ?? '')) setMapState('error')
    })
    const observer = new ResizeObserver(() => { map.resize(); setSizeRevision(value => value + 1) })
    observer.observe(container.current)
    return () => {
      disposed = true
      window.clearTimeout(deadline)
      observer.disconnect()
      markers.forEach(marker => marker.remove())
      map.remove()
      mapRef.current = null
    }
  }, [attempt])

  // One clock drives drawing, camera, captions and progress. Pause freezes all of them.
  useEffect(() => {
    if (!playing || waiting) return
    let raf = 0
    let previous = performance.now()
    let lastPaint = previous
    const tick = (now: number) => {
      const before = clockRef.current
      clockRef.current = advanceStory(before, Math.min(200, now - previous))
      previous = now
      if (now - lastPaint >= 32 || before.scene !== clockRef.current.scene) {
        setClock({ ...clockRef.current })
        lastPaint = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, waiting])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapState !== 'ready') return
    const sceneKey = `${scene}:${revision}:${sizeRevision}:${Boolean(route)}:${ranges.length}:${reducedMotion}`
    if (cameraRef.current?.key !== sceneKey) {
      const features: PolyFeature[] = scene < 2 ? [] : ranges.slice(0, scene === 2 ? 1 : 2).map((range, i) => ({
        ...range, properties: { color: PLACES[i].color, opacity: .14 },
      }))
      if (scene === 3 && commonRange) features.push({ ...commonRange, properties: { color: '#c6a1ff', opacity: .26 } })
      ;(map.getSource('welcome-ranges') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
      const wholeRoute = routeAtProgressIfReady(route)
      ;(map.getSource('welcome-route-base') as mapboxgl.GeoJSONSource).setData(scene > 0 && wholeRoute ? wholeRoute.line : EMPTY)
      if (scene !== 1) {
        ;(map.getSource('welcome-route') as mapboxgl.GeoJSONSource).setData(scene > 0 && wholeRoute ? wholeRoute.line : EMPTY)
        ;(map.getSource('welcome-traveler') as mapboxgl.GeoJSONSource).setData(EMPTY)
      }
      const current = map.getCenter()
      const from: Camera = { center: [current.lng, current.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
      let to: Camera
      if (scene === 0) {
        to = { center: [PLACES[0].lngLat[0], PLACES[0].lngLat[1] + .003], zoom: 13.5, pitch: 42, bearing: -18 }
      } else {
        const bounds = new mapboxgl.LngLatBounds().extend(PLACES[0].lngLat).extend(PLACES[1].lngLat)
        if (scene === 1 && route) route.path.coordinates.forEach(point => bounds.extend(point))
        if (features.length) {
          const extent = bbox({ type: 'FeatureCollection', features })
          bounds.extend([extent[0], extent[1]]).extend([extent[2], extent[3]])
        }
        const camera = map.cameraForBounds(bounds, { padding: { top: scene === 1 ? 220 : 160, bottom: 80, left: 72, right: 72 }, maxZoom: 12.2, bearing: 0 })
        const center = camera?.center ? mapboxgl.LngLat.convert(camera.center) : bounds.getCenter()
        // Leave room for endpoint labels when the tilted camera follows the traveler.
        to = { center: [center.lng, center.lat], zoom: (camera?.zoom ?? 11.3) - (scene === 1 ? .2 : 0), pitch: scene === 1 ? 30 : 12, bearing: 0 }
      }
      cameraRef.current = { key: sceneKey, from, to }
    }
    const camera = cameraRef.current
    const target = { ...camera.to, center: [...camera.to.center] as [number, number] }
    if (scene === 1 && route) {
      const revealed = routeAtProgress(route.path, routeProgress)
      ;(map.getSource('welcome-route') as mapboxgl.GeoJSONSource).setData(revealed.line)
      ;(map.getSource('welcome-traveler') as mapboxgl.GeoJSONSource).setData(revealed.point)
      if (!reducedMotion) {
        const midpoint = routeAtProgress(route.path, .5).point.geometry.coordinates
        target.center[0] += (revealed.point.geometry.coordinates[0] - midpoint[0]) * .08
        target.center[1] += (revealed.point.geometry.coordinates[1] - midpoint[1]) * .08
        target.bearing = -7 + routeProgress * 14
      }
    }
    if (scene >= 2) map.setPaintProperty('welcome-fill', 'fill-opacity', ['*', ['get', 'opacity'], reducedMotion ? 1 : smooth(progress / .35)])
    const t = reducedMotion ? 1 : smooth(progress / (scene === 0 ? .8 : .24))
    const mix = (a: number, b: number) => a + (b - a) * t
    map.jumpTo({
      center: [mix(camera.from.center[0], target.center[0]), mix(camera.from.center[1], target.center[1])],
      zoom: mix(camera.from.zoom, target.zoom), pitch: mix(camera.from.pitch, target.pitch), bearing: mix(camera.from.bearing, target.bearing),
    })
  }, [clock, scene, progress, routeProgress, mapState, route, ranges, commonRange, revision, sizeRevision, reducedMotion])

  function selectScene(index: number) {
    clockRef.current = { scene: index, elapsed: 0 }
    setClock(clockRef.current)
    setRevision(value => value + 1)
  }
  const arrived = reducedMotion || routeProgress > .72
  const routeReady = routeState === 'ready' && route

  return (
    <section className="welcome-figure welcome-real-figure" aria-label="南山到福田动态地图介绍">
      <div className="figure-topline"><span>南山 × 福田 · 一段城市日常</span><span>深圳 / SHENZHEN</span></div>
      <div ref={frame} className={`welcome-map-frame welcome-map-scene-${scene}`} data-playing={playing && !waiting}>
        <div className="welcome-real-map" ref={container} />
        {mapState !== 'ready' ? <div className="welcome-map-status" role="status">
          <strong>{mapState === 'loading' ? '正在展开深圳地图' : '地图暂时未能加载'}</strong>
          <p>{mapState === 'loading' ? '载入街区与真实路线…' : '请检查网络后重试，或直接进入地图工具。'}</p>
          {mapState === 'error' && <button onClick={() => setAttempt(value => value + 1)}>重新加载 ↗</button>}
        </div> : <>
          <div className="welcome-cinematic-caption">
            <div className="welcome-scene-kicker"><span className="welcome-status-dot" />{paused ? '已暂停' : waiting ? '正在准备路线' : '城市日常 · 自动演示'}</div>
            <div className="welcome-cinematic-legend"><span>地点</span><span>路线</span><span>生活圈</span></div>
            <h2 className="sr-only">{SCENES[scene]}</h2>
            <div className="welcome-cinematic-copy" key={scene} aria-hidden="true">
              {scene === 0 && <><span>把日常的起点，</span><br /><span>放在 <mark className="ink-place">南山高新园</mark>。</span></>}
              {scene === 1 && <><span>从 <mark className="ink-place">南山</mark> 出发，</span><br /><span className={routeProgress > .1 || reducedMotion ? 'phrase-visible' : 'phrase-hidden'}>沿着真实道路 <mark className="ink-route">驾车</mark>，</span><br /><span className={arrived ? 'phrase-visible' : 'phrase-hidden'}>去 <mark className="ink-destination">福田购物公园</mark>。</span></>}
              {scene === 2 && <><span>给路上 <mark className="ink-route">30 分钟</mark>，</span><br /><span>看看生活能延伸到哪里。</span></>}
              {scene === 3 && <><span><mark className="ink-place">南山</mark> 与 <mark className="ink-destination">福田</mark>，</span><br /><span>{rangeState !== 'ready' ? '比较两处日常的生活半径。' : !commonRange ? '两处生活圈暂未相交。' : <>在 <mark className="ink-area">共同生活圈</mark> 相遇。</>}</span></>}
            </div>
          </div>
          <div className="welcome-map-readout" aria-live="polite">
            {scene === 0 ? <><span>起点 / NANSHAN</span><strong>高新园站</strong></> : scene === 1 ? <><span>真实驾车路线 · 行程估算</span><strong>{routeReady ? `${(route.meters / 1000).toFixed(1)} km` : routeState === 'error' ? '路线暂不可用' : '正在计算'}{routeReady && <small>约 {Math.ceil(route.seconds / 60)} 分钟</small>}</strong></> : <><span>驾车可达范围 · 路网估算</span><strong>{rangeState === 'ready' ? '30 分钟' : rangeState === 'loading' ? '正在计算' : '范围暂不可用'}<small>{scene === 3 ? '南山 × 福田' : '从高新园出发'}</small></strong></>}
          </div>
          <div className="welcome-scene-number" aria-hidden="true">0{scene + 1}<span> / 04</span></div>
        </>}
      </div>
      <div className="welcome-map-steps" aria-label="地图介绍步骤">
        {['选地点', '看路线', '看范围', '找交集'].map((title, index) => <button key={title} className="welcome-step" aria-pressed={scene === index} onClick={() => selectScene(index)}><span>0{index + 1}</span>{title}<i aria-hidden="true" style={{ transform: `scaleX(${index < scene ? 1 : index === scene ? progress : 0})` }} /></button>)}
        <button className="welcome-map-play" disabled={mapState !== 'ready'} aria-label={paused ? '继续自动播放' : '暂停自动播放'} onClick={() => setPaused(value => !value)}>{paused ? '播放 →' : '暂停 ‖'}</button>
        <button className="welcome-map-replay" disabled={mapState !== 'ready'} aria-label="从头自动播放" onClick={() => { selectScene(0); setPaused(false) }}>重播 ↗</button>
      </div>
      <p className="welcome-map-note" role="status">
        {mapState === 'error' ? '底图加载失败，请重试。' : routeState === 'error' ? '路线暂时不可用；保留真实地点与范围演示。' : rangeState === 'error' || rangeState === 'empty' ? '可达范围暂时不可用；保留真实路线演示。' : '真实路线与范围来自 Mapbox；非实时路况，动画为加速演示。'}
        {mapState === 'ready' && (routeState === 'error' || rangeState === 'error') && <button onClick={() => setAttempt(value => value + 1)}>重试 ↗</button>}
      </p>
    </section>
  )
}

function routeAtProgressIfReady(route: IntroRoute | null) {
  return route ? routeAtProgress(route.path, 1) : null
}
