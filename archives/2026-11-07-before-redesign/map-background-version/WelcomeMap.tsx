import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { bbox, pointOnFeature } from '@turf/turf'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getMapboxToken } from '../mapbox/token'
import { getProvider } from '../providers'
import { intersectAll, simplifyForOps, type PolyFeature } from '../geometry/ops'
import { advanceStory, PLACES, SCENE_DURATIONS, type StoryClock } from '../welcome/story'
import type { FeatureCollection } from 'geojson'
import './WelcomeMap.css'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const INTRO_MINUTES = 30
const INTRO_MODE = 'subway-walking' as const
const INTRO_MODE_LABEL = '地铁＋步行'
const STORY_COLORS = ['#6799ab', '#a28eae']
const MEETING_COLOR = '#557fa0'
const SCENES = ['你在前海，有自己的日常', 'TA 在后海，也有自己的生活', `各自留出 ${INTRO_MINUTES} 分钟，看看哪里都方便`, '在共同的生活圈里，相约见面']
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
  const [ranges, setRanges] = useState<PolyFeature[]>([])
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [attempt, setAttempt] = useState(0)
  const [revision, setRevision] = useState(0)
  const [sizeRevision, setSizeRevision] = useState(0)
  const [clock, setClock] = useState<StoryClock>({ scene: 0, elapsed: 0 })
  const clockRef = useRef(clock)
  const cameraRef = useRef<{ key: string; from: Camera; to: Camera } | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const scene = clock.scene
  const progress = clock.elapsed / SCENE_DURATIONS[scene]
  const waiting = scene >= 2 && rangeState === 'loading'
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
    const onMotion = () => {
      setReducedMotion(media.matches)
      if (media.matches) setPaused(true)
    }
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
    const rangeController = new AbortController()
    let map: mapboxgl.Map
    const markers: mapboxgl.Marker[] = []
    cameraRef.current = null
    setMapState('loading')
    setRangeState('loading')
    setRanges([])
    try {
      map = new mapboxgl.Map({
        container: container.current,
        accessToken: getMapboxToken(),
        style: 'mapbox://styles/mapbox/light-v11',
        center: PLACES[0].lngLat, zoom: 11.4, pitch: 28, bearing: -12,
        interactive: false, attributionControl: false,
      })
    } catch { setMapState('error'); return }
    mapRef.current = map
    map.addControl(new mapboxgl.AttributionControl({ compact: true }))
    map.getCanvas().setAttribute('tabindex', '-1')
    map.getCanvas().setAttribute('aria-label', `两个人分别从前海和后海出发，寻找各自${INTRO_MODE_LABEL} ${INTRO_MINUTES} 分钟内都方便到达的相聚区域`)
    const deadline = window.setTimeout(() => { if (!disposed) setMapState('error') }, 25000)
    map.on('load', () => {
      if (disposed) return
      window.clearTimeout(deadline)
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#f2f5f6')
        if (layer.type === 'symbol' && layer.layout?.['text-field']) {
          map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name_zh-Hans'], ['get', 'name_zh-Hant'], ['get', 'name']])
        }
      }
      if (map.getLayer('water')) map.setPaintProperty('water', 'fill-color', '#dce8ed')
      const labelLayer = map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id
      map.addSource('welcome-ranges', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'welcome-fill', type: 'fill', source: 'welcome-ranges', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'], 'fill-opacity-transition': { duration: 0 } } }, labelLayer)
      map.addLayer({ id: 'welcome-line', type: 'line', source: 'welcome-ranges', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': .65 } }, labelLayer)
      map.addSource('welcome-meeting', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'welcome-meeting-label', type: 'symbol', source: 'welcome-meeting', layout: {
        'text-field': '在这一带见面', 'text-size': 18, 'text-allow-overlap': true,
      }, paint: { 'text-color': '#426881', 'text-halo-color': '#ffffff', 'text-halo-width': 3 } })
      PLACES.forEach((place, i) => {
        const element = document.createElement('div')
        element.className = `welcome-place welcome-place-${i}`
        element.style.setProperty('--place-color', STORY_COLORS[i])
        const dot = document.createElement('span')
        dot.textContent = i === 0 ? '你' : 'TA'
        const label = document.createElement('strong')
        label.textContent = `${i === 0 ? '你的日常' : 'TA 的日常'} · ${place.name}`
        element.append(dot, label)
        markers.push(new mapboxgl.Marker({ element, anchor: 'center' }).setLngLat(place.lngLat).addTo(map))
      })
      setMapState('ready')
      const provider = getProvider(INTRO_MODE)
      void Promise.all(PLACES.map(place => provider.fetch({ lngLat: place.lngLat, mode: INTRO_MODE, minutes: INTRO_MINUTES, signal: rangeController.signal }))).then(results => {
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
      rangeController.abort()
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
    const rangeSource = map.getSource('welcome-ranges') as mapboxgl.GeoJSONSource | undefined
    const meetingSource = map.getSource('welcome-meeting') as mapboxgl.GeoJSONSource | undefined
    // A replacement map can still be loading when React preserves the previous ready state.
    if (!rangeSource || !meetingSource) return
    const sceneKey = `${scene}:${revision}:${sizeRevision}:${ranges.length}:${reducedMotion}`
    if (cameraRef.current?.key !== sceneKey) {
      const features: PolyFeature[] = scene < 2 ? [] : ranges.map((range, i) => ({
        ...range, properties: { color: STORY_COLORS[i], opacity: scene === 3 ? .12 : .23 },
      }))
      if (scene === 3 && commonRange) features.push({ ...commonRange, properties: { color: MEETING_COLOR, opacity: .42 } })
      rangeSource.setData({ type: 'FeatureCollection', features })
      meetingSource.setData(
        scene === 3 && commonRange ? pointOnFeature(commonRange) : EMPTY,
      )
      const current = map.getCenter()
      const from: Camera = { center: [current.lng, current.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
      let to: Camera
      if (scene < 2) {
        const place = PLACES[scene]
        to = { center: [place.lngLat[0], place.lngLat[1] + .003], zoom: 13.5, pitch: 42, bearing: -18 }
      } else {
        const bounds = new mapboxgl.LngLatBounds().extend(PLACES[0].lngLat).extend(PLACES[1].lngLat)
        if (features.length) {
          const extent = bbox(scene === 3 && commonRange ? commonRange : { type: 'FeatureCollection', features })
          bounds.extend([extent[0], extent[1]]).extend([extent[2], extent[3]])
        }
        const narrow = map.getContainer().clientWidth <= 600
        const camera = map.cameraForBounds(bounds, { padding: { top: narrow ? 105 : 155, bottom: narrow ? 150 : 70, left: narrow ? 26 : 90, right: narrow ? 26 : 90 }, maxZoom: 12.2, bearing: 0 })
        const center = camera?.center ? mapboxgl.LngLat.convert(camera.center) : bounds.getCenter()
        to = { center: [center.lng, center.lat], zoom: camera?.zoom ?? 11.3, pitch: 12, bearing: 0 }
      }
      cameraRef.current = { key: sceneKey, from, to }
    }
    const camera = cameraRef.current
    const target = { ...camera.to, center: [...camera.to.center] as [number, number] }
    if (scene >= 2) map.setPaintProperty('welcome-fill', 'fill-opacity', ['*', ['get', 'opacity'], reducedMotion ? 1 : smooth(progress / .35)])
    if (scene === 3) map.setPaintProperty('welcome-meeting-label', 'text-opacity', reducedMotion ? 1 : smooth(progress / .35))
    const t = reducedMotion ? 1 : smooth(progress / (scene === 0 ? .8 : .24))
    const mix = (a: number, b: number) => a + (b - a) * t
    map.jumpTo({
      center: [mix(camera.from.center[0], target.center[0]), mix(camera.from.center[1], target.center[1])],
      zoom: mix(camera.from.zoom, target.zoom), pitch: mix(camera.from.pitch, target.pitch), bearing: mix(camera.from.bearing, target.bearing),
    })
  }, [clock, scene, progress, mapState, ranges, commonRange, revision, sizeRevision, reducedMotion])

  function selectScene(index: number) {
    clockRef.current = { scene: index, elapsed: 0 }
    setClock(clockRef.current)
    setRevision(value => value + 1)
  }

  return (
    <section className="welcome-figure welcome-real-figure" aria-label="两个人的生活圈，相约见面的动态地图介绍">
      <div className="figure-topline"><span>一段关于「刚刚好」的相遇</span><span>深圳 · SHENZHEN</span></div>
      <div ref={frame} className={`welcome-map-frame welcome-map-scene-${scene}`} data-playing={playing && !waiting}>
        <div className="welcome-real-map" ref={container} />
        {mapState !== 'ready' ? <div className="welcome-map-status" role="status">
          <strong>{mapState === 'loading' ? '正在展开深圳地图' : '地图暂时未能加载'}</strong>
          <p>{mapState === 'loading' ? '正在展开你们的日常…' : '请检查网络后重试，或直接进入地图工具。'}</p>
          {mapState === 'error' && <button onClick={() => setAttempt(value => value + 1)}>重新加载 ↗</button>}
        </div> : <>
          <div className="welcome-cinematic-caption">
            <div className="welcome-scene-kicker"><span className="welcome-status-dot" />{paused ? '演示已暂停' : waiting ? '正在寻找共同的生活圈' : '两个人的日常 · 实景演示'}</div>
            <div className="welcome-cinematic-legend"><span>你 · {INTRO_MINUTES} 分钟</span><span>TA · {INTRO_MINUTES} 分钟</span><span>相聚的区域</span></div>
            <h2 className="sr-only">{SCENES[scene]}</h2>
            <div className="welcome-cinematic-copy" key={scene} aria-hidden="true">
              {scene === 0 && <><span>你在 <mark className="ink-place">前海</mark>，</span><br /><span>有自己熟悉的日常。</span></>}
              {scene === 1 && <><span>TA 在 <mark className="ink-destination">后海</mark>，</span><br /><span>也有自己的生活节奏。</span></>}
              {scene === 2 && <><span>各自留出 <mark className="ink-route">{INTRO_MINUTES} 分钟</mark>，</span><br /><span>看看哪里，你们都方便。</span></>}
              {scene === 3 && <><span>{rangeState !== 'ready' ? '等生活圈展开，再约个地方。' : !commonRange ? `${INTRO_MINUTES} 分钟还不够让生活圈相遇。` : <>就在 <mark className="ink-area">这一带</mark> 见面吧。</>}</span><br /><span>{rangeState !== 'ready' ? '找一处彼此都方便的地方。' : !commonRange ? '多留一点时间，再找找看。' : '一起吃顿饭，或喝杯咖啡。'}</span></>}
            </div>
          </div>
          <div className="welcome-map-readout" aria-live="polite">
            {scene < 2 ? <><span>{scene === 0 ? '你的日常，在这里' : 'TA 的日常，在这里'}</span><strong>{scene === 0 ? '前海湾' : '后海'}</strong></> : <><span>{rangeState === 'ready' ? scene === 3 && commonRange ? '深蓝区域 · 你们都能到达' : scene === 3 ? '试着多留一点路上的时间' : '青色是你，蓝紫色是 TA' : '生活圈正在准备中'}</span><strong>{rangeState === 'ready' ? `各自 ${INTRO_MINUTES} 分钟` : rangeState === 'loading' ? '正在寻找' : '暂未找到'}<small>{INTRO_MODE_LABEL} · 估算范围</small></strong></>}
          </div>
          <div className="welcome-scene-number" aria-hidden="true">0{scene + 1}<span> / 04</span></div>
        </>}
      </div>
      <div className="welcome-map-steps" aria-label="地图介绍步骤">
        {['你的日常', 'TA 的日常', `各自 ${INTRO_MINUTES} 分钟`, '相约见面'].map((title, index) => <button key={title} className="welcome-step" aria-pressed={scene === index} onClick={() => selectScene(index)}><span>0{index + 1}</span>{title}<i aria-hidden="true" style={{ transform: `scaleX(${index < scene ? 1 : index === scene ? progress : 0})` }} /></button>)}
        <button className="welcome-map-play" disabled={mapState !== 'ready'} aria-label={paused ? '继续自动播放' : '暂停自动播放'} onClick={() => setPaused(value => !value)}>{paused ? '播放 →' : '暂停 ‖'}</button>
        <button className="welcome-map-replay" disabled={mapState !== 'ready'} aria-label="从头自动播放" onClick={() => { selectScene(0); setPaused(false) }}>重播 ↗</button>
      </div>
      <p className="welcome-map-note">{INTRO_MODE_LABEL} {INTRO_MINUTES} 分钟，含候车与换乘；暂不含公交车线路。</p>
      {(mapState === 'error' || rangeState === 'error' || rangeState === 'empty') && <p className="welcome-map-note" role="status">
        {mapState === 'error' ? '地图暂时未能展开，请重试。' : '生活圈暂时未能加载，重试后再看看哪里适合见面。'}
        {mapState === 'ready' && <button onClick={() => setAttempt(value => value + 1)}>重试 ↗</button>}
      </p>}
    </section>
  )
}
