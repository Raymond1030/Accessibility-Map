import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getMapboxToken } from '../mapbox/token'
import { useStore } from '../state/store'
import { cellKey, type Origin } from '../types'
import { computeBand, computeCustomBand } from '../state/compute'
import { shouldAddOnMapClick, useIsMobile } from '../ui/responsive'
import { locateCurrentPosition } from '../geo/locate'
import { ResultsPanel, type ResultItem } from './ResultsPanel'
import {
  RANGE_DASH,
  RESULT_CASING_EXTRA,
  RESULT_COLOR,
  RESULT_LINE_WIDTH,
  originCode,
  originBandLineOpacity,
  originBandLineWidth,
  originBandOpacity,
  resultBandLineWidth,
  resultBandOpacity,
  resultCasingDash,
} from '../ui/mapStyle'
import {
  ORIGIN_MARKER_HIT_RADIUS,
  createOriginMarkerImage,
  originMarkerImageId,
  parseOriginMarkerImageId,
} from '../ui/originMarker'
import { loadMarkerIconImages } from '../ui/markerIcons'
import type { PolyFeature } from '../geometry/ops'
import type { FeatureCollection, Point } from 'geojson'
import './MapView.css'
import { useCommute } from '../commute/store'
import { useCommuteMap } from '../commute/useCommuteMap'
import { useNavigation } from '../state/navigation'
import { useExplore } from '../explore/store'
import { useLifeMap } from '../explore/useLifeMap'
import { RANGE_LABELS } from '../commute/range'
import { overlayInsets } from '../ui/mapInsets'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const ORIGIN_POINTS_SOURCE = 'origin-points'
const ORIGIN_POINT_HIT_LAYER = 'origin-point-hit'
const ORIGIN_SYMBOL_LAYER = 'origin-symbols'
// 出发地标记按设备像素比绘制（至少 2 倍、至多 3 倍），高分屏上边缘和字母也清晰
const MARKER_PIXEL_RATIO = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1)))

type OriginPointProperties = {
  originId: string
  iconImage: string
  code: string
  color: string
  visible: boolean
}

type OriginPointCollection = FeatureCollection<Point, OriginPointProperties>

function buildOriginPointCollection(origins: Origin[]): OriginPointCollection {
  return {
    type: 'FeatureCollection',
    features: origins.map((origin, index) => ({
      type: 'Feature',
      id: origin.id,
      properties: {
        originId: origin.id,
        iconImage: originMarkerImageId(origin.color, origin.markerIcon, originCode(index)),
        code: originCode(index),
        color: origin.color,
        visible: origin.visible,
      },
      geometry: { type: 'Point', coordinates: origin.lngLat },
    })),
  }
}

/** 「定位到我的位置」：准星圆环＋中心实心点，地图应用通用的定位图标；定位中中心点会呼吸闪烁 */
function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="6.5" />
      <circle className="locate-dot" cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7" />
    </svg>
  )
}

/** Mapbox streets 在中国区默认英文/拼音标注，逐层改成优先取中文 */
function applyChineseLabels(map: mapboxgl.Map): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== 'symbol') continue
    try {
      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce', ['get', 'name_zh-Hans'], ['get', 'name_zh-Hant'], ['get', 'name'],
      ])
    } catch { /* 个别图层不支持覆盖，跳过 */ }
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const scene = useNavigation(s => s.scene)
  const explorePicking = useExplore(s => s.picking)
  const commutePicking = useCommute(s => s.picking)
  const commuteView = useCommute(s => s.view)
  const rangeMode = useCommute(s => s.rangeMode)
  const rangeMinutes = useCommute(s => s.rangeMinutes)
  const rangeStatus = useCommute(s => s.rangeResult.status)
  useCommuteMap(mapRef, mapReady)
  useLifeMap(mapRef, mapReady)

  const origins = useStore((s) => s.origins)
  const cells = useStore((s) => s.cells)
  const geoms = useStore((s) => s.geoms)
  const op = useStore((s) => s.op)
  const bandMode = useStore((s) => s.bandMode)
  const globalThresholds = useStore((s) => s.globalThresholds)
  const baseOriginId = useStore((s) => s.baseOriginId)
  const addOrigin = useStore((s) => s.addOrigin)
  const updateOrigin = useStore((s) => s.updateOrigin)
  const setFatalError = useStore((s) => s.setFatalError)
  const pickingMode = useStore((s) => s.pickingMode)
  const setPickingMode = useStore((s) => s.setPickingMode)
  const isMobile = useIsMobile()

  // Mapbox 事件只注册一次，用 ref 读取最新 React/Zustand 状态。
  const originsRef = useRef(origins)
  const updateOriginRef = useRef(updateOrigin)
  originsRef.current = origins
  updateOriginRef.current = updateOrigin
  const draggingRef = useRef<{
    originId: string
    data: OriginPointCollection
    lngLat: [number, number]
    /** 按下时光标／手指相对坐标点的屏幕偏移。拖动中保持不变，标记不会一下跳到手指底下 */
    grab: [number, number]
    moved: boolean
  } | null>(null)
  const suppressMapClickUntilRef = useRef(0)

  const visibleOrigins = useMemo(() => origins.filter((origin) => origin.visible), [origins])
  const visibleIds = useMemo(() => visibleOrigins.map((origin) => origin.id), [visibleOrigins])
  const resultBands = useMemo(
    () => (bandMode === 'paired' ? globalThresholds : [visibleOrigins[0]?.thresholds[0] ?? 0]),
    [bandMode, globalThresholds, visibleOrigins],
  )
  const resultItems = useMemo<ResultItem[]>(() => {
    if (bandMode === 'custom') {
      const minutesByOrigin = new Map(visibleOrigins.flatMap((origin) => {
        const minutes = origin.thresholds[0]
        return minutes === undefined ? [] : [[origin.id, minutes] as const]
      }))
      return [{
        minutes: resultBands[0] ?? 0,
        label: '分别设置',
        minutesByOrigin: Object.fromEntries(minutesByOrigin),
        result: computeCustomBand({
          op,
          originIds: visibleIds,
          minutesByOrigin,
          cells,
          geoms,
          baseOriginId,
        }),
      }]
    }

    return resultBands.map((minutes) => ({
      minutes,
      result: computeBand({
        op,
        minutes,
        originIds: visibleIds,
        cells,
        geoms,
        baseOriginId,
      }),
    }))
  }, [bandMode, baseOriginId, cells, geoms, op, resultBands, visibleIds, visibleOrigins])

  // 建图 effect 只跑一次，click 闭包会锁死首次渲染的状态，用 ref 兜住
  const clickGuardRef = useRef({ isMobile: false, picking: false })
  clickGuardRef.current = { isMobile, picking: pickingMode }

  const [locating, setLocating] = useState(false)
  const [locateMsg, setLocateMsg] = useState<string | null>(null)

  async function handleLocate() {
    setLocating(true)
    setLocateMsg(null)
    try {
      const r = await locateCurrentPosition()
      if (useNavigation.getState().scene === 'explore') {
        useExplore.getState().setCenter({ name: '我的位置', lngLat: r.lngLat })
        mapRef.current?.flyTo({ center: r.lngLat, zoom: 14 })
      } else if (useNavigation.getState().scene === 'commute') {
        mapRef.current?.flyTo({ center: r.lngLat, zoom: 14 })
        setLocateMsg('已定位，可用面板中的地图选点按钮标记公司或住处。')
      } else addOrigin(r.lngLat, '我的位置')
    } catch (e) {
      setLocateMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setLocating(false)
    }
  }

  // 建图，只做一次
  useEffect(() => {
    if (!containerRef.current) return
    let map: mapboxgl.Map
    try {
      mapboxgl.accessToken = getMapboxToken()
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [113.9435, 22.5333],
        zoom: 11,
        attributionControl: false,
      })
    } catch (e) {
      setFatalError(e instanceof Error ? e.message : String(e))
      return
    }

    map.addControl(new mapboxgl.AttributionControl({ compact: true }))

    map.on('style.load', () => applyChineseLabels(map))

    // 出发地标记图片按「颜色:图标:代号」现用现画：symbol 图层第一次引用某个 id 时 Mapbox 发出
    // styleimagemissing，在回调里同步 addImage 就能赶上这一帧，不必预先注册所有组合。
    const markerImageIds = new Set<string>()
    map.on('styleimagemissing', ({ id }) => {
      const spec = parseOriginMarkerImageId(id)
      if (!spec || map.hasImage(id)) return
      map.addImage(id, createOriginMarkerImage(spec, MARKER_PIXEL_RATIO), { pixelRatio: MARKER_PIXEL_RATIO })
      markerImageIds.add(id)
    })
    // 彩色图标解码完之前画出的标记还没有图标：解码完把这些标记图片重画一遍（尺寸不变，可直接 updateImage）。
    // 只遍历自己注册过的 id——它们都是样式加载完后才加上的；图标常常比底图样式先就绪，
    // 这时调 map.listImages() 会抛「Style is not done loading」。
    let disposed = false
    void loadMarkerIconImages().then(() => {
      if (disposed) return
      for (const id of markerImageIds) {
        const spec = parseOriginMarkerImageId(id)
        if (spec && map.hasImage(id)) map.updateImage(id, createOriginMarkerImage(spec, MARKER_PIXEL_RATIO))
      }
    })

    const canvas = map.getCanvasContainer()

    const moveDraggedPoint = (event: mapboxgl.MapLayerMouseEvent | mapboxgl.MapLayerTouchEvent) => {
      const dragging = draggingRef.current
      if (!dragging) return
      const { lng, lat } = map.unproject([event.point.x - dragging.grab[0], event.point.y - dragging.grab[1]])
      const lngLat: [number, number] = [lng, lat]
      const feature = dragging.data.features.find(
        (candidate) => candidate.properties.originId === dragging.originId,
      )
      if (!feature) return
      feature.geometry.coordinates = lngLat
      dragging.lngLat = lngLat
      dragging.moved = true
      canvas.style.cursor = 'grabbing'
      ;(map.getSource(ORIGIN_POINTS_SOURCE) as mapboxgl.GeoJSONSource).setData(dragging.data)
    }

    const finishDragging = () => {
      const dragging = draggingRef.current
      draggingRef.current = null
      map.off('mousemove', moveDraggedPoint)
      map.off('touchmove', moveDraggedPoint)
      canvas.style.cursor = ''
      if (!dragging?.moved) return
      suppressMapClickUntilRef.current = performance.now() + 350
      updateOriginRef.current(dragging.originId, { lngLat: dragging.lngLat })
    }

    const beginDragging = (event: mapboxgl.MapLayerMouseEvent | mapboxgl.MapLayerTouchEvent) => {
      if (useNavigation.getState().scene !== 'isochrone') return false
      const originId = event.features?.[0]?.properties?.originId
      if (typeof originId !== 'string') return false
      const origin = originsRef.current.find((candidate) => candidate.id === originId)
      if (!origin) return false
      event.preventDefault()
      const anchor = map.project(origin.lngLat)
      draggingRef.current = {
        originId,
        data: buildOriginPointCollection(originsRef.current),
        lngLat: [...origin.lngLat],
        grab: [event.point.x - anchor.x, event.point.y - anchor.y],
        moved: false,
      }
      canvas.style.cursor = 'grab'
      return true
    }

    const startMouseDragging = (event: mapboxgl.MapLayerMouseEvent) => {
      if (!beginDragging(event)) return
      map.on('mousemove', moveDraggedPoint)
      map.once('mouseup', finishDragging)
    }

    const startTouchDragging = (event: mapboxgl.MapLayerTouchEvent) => {
      if (event.points.length !== 1 || !beginDragging(event)) return
      map.on('touchmove', moveDraggedPoint)
      map.once('touchend', finishDragging)
    }

    map.on('load', () => {
      // source/layer 必须在 load 后添加；后续 React effect 只更新 GeoJSON 数据。
      map.addSource('origins-iso', { type: 'geojson', data: EMPTY_FC })
      map.addSource('result-iso', { type: 'geojson', data: EMPTY_FC })
      map.addSource(ORIGIN_POINTS_SOURCE, { type: 'geojson', data: EMPTY_FC })

      // 每个 feature 自带与侧栏图例一致的透明度和线宽：近时段更浓，
      // 远时段更淡。不要在这里另写常量，否则图例会和地图失配。
      // 范围边界一律画虚线（RANGE_DASH，与首页案例卡片相同）。
      map.addLayer({
        id: 'origins-fill',
        type: 'fill',
        source: 'origins-iso',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.18],
        },
      })
      map.addLayer({
        id: 'origins-line',
        type: 'line',
        source: 'origins-iso',
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': ['coalesce', ['get', 'lineOpacity'], 0.8],
          'line-width': ['coalesce', ['get', 'lineWidth'], 1.8],
          'line-dasharray': RANGE_DASH,
        },
      })
      // 紫色只表示「多个点的集合运算结果」。单点不画这一层，保留点本身
      // 的识别色。白色 casing 让结果边界在道路、水面和绿地上都能读清；
      // 它跟着紫色虚线一段段断开（casingDash），空隙里照样露出底图。
      // 两层的线宽都要保持按要素取值、且不随缩放变化：Mapbox 对常量线宽另有缩放处理，
      // 只改一层就会在缩放过渡时错开。
      map.addLayer({
        id: 'result-fill',
        type: 'fill',
        source: 'result-iso',
        paint: {
          'fill-color': RESULT_COLOR,
          'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.18],
        },
      })
      map.addLayer({
        id: 'result-casing',
        type: 'line',
        source: 'result-iso',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['+', ['coalesce', ['get', 'lineWidth'], RESULT_LINE_WIDTH], RESULT_CASING_EXTRA],
          'line-opacity': 0.94,
          'line-dasharray': ['array', 'number', 2, ['coalesce', ['get', 'casingDash'], ['literal', resultCasingDash(RESULT_LINE_WIDTH)]]],
        },
      })
      map.addLayer({
        id: 'result-line',
        type: 'line',
        source: 'result-iso',
        paint: {
          'line-color': RESULT_COLOR,
          'line-width': ['coalesce', ['get', 'lineWidth'], RESULT_LINE_WIDTH],
          'line-opacity': 0.98,
          'line-dasharray': RANGE_DASH,
        },
      })

      // 出发地标记整张由 symbol 图层画出（识别色、图标、代号都在图里，见 ui/originMarker），
      // 方块中心就是坐标点。这一层透明的圆只当拖拽和点击的命中区。
      map.addLayer({
        id: ORIGIN_POINT_HIT_LAYER,
        type: 'circle',
        source: ORIGIN_POINTS_SOURCE,
        paint: {
          'circle-radius': ORIGIN_MARKER_HIT_RADIUS,
          'circle-color': '#ffffff',
          'circle-opacity': 0,
        },
      })
      map.addLayer({
        id: ORIGIN_SYMBOL_LAYER,
        type: 'symbol',
        source: ORIGIN_POINTS_SOURCE,
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': ['case', ['get', 'visible'], 1, 0.5],
        },
      })

      map.on('mouseenter', ORIGIN_POINT_HIT_LAYER, () => {
        if (!draggingRef.current) canvas.style.cursor = 'move'
      })
      map.on('mouseleave', ORIGIN_POINT_HIT_LAYER, () => {
        if (!draggingRef.current) canvas.style.cursor = ''
      })
      map.on('mousedown', ORIGIN_POINT_HIT_LAYER, startMouseDragging)
      map.on('touchstart', ORIGIN_POINT_HIT_LAYER, startTouchDragging)

      setMapReady(true)
    })

    map.on('click', (e) => {
      if (performance.now() < suppressMapClickUntilRef.current) return
      const commute = useCommute.getState()
      if (useNavigation.getState().scene === 'explore') {
        if (useExplore.getState().picking) {
          useExplore.getState().setCenter({ name: '探索起点（地图选点）', lngLat: [e.lngLat.lng, e.lngLat.lat] })
          useStore.getState().setDrawerOpen(true)
        }
        return
      }
      if (useNavigation.getState().scene === 'commute') {
        const place = { lngLat: [e.lngLat.lng, e.lngLat.lat] as [number, number], name: commute.picking === 'work' ? '公司（地图选点）' : `候选住处 ${commute.homes.length + 1}` }
        if (commute.picking === 'work') commute.setWorkplace(place)
        if (commute.picking === 'home' && !commute.busy) commute.addHome(place)
        if (commute.picking) useStore.getState().setDrawerOpen(true)
        return
      }
      if (
        map.getLayer(ORIGIN_POINT_HIT_LAYER)
        && map.queryRenderedFeatures(e.point, { layers: [ORIGIN_POINT_HIT_LAYER] }).length > 0
      ) return
      const { isMobile: mob, picking } = clickGuardRef.current
      if (!shouldAddOnMapClick(mob, picking)) return
      addOrigin([e.lngLat.lng, e.lngLat.lat], '')
    })

    map.on('error', (e) => {
      const msg = e.error?.message ?? ''
      // 401/403 类的加载失败是配置问题，其余（瓦片超时等）不弹全局错误
      if (/401|403|Unauthorized|Forbidden/i.test(msg)) {
        setFatalError(`Mapbox 底图加载失败：${msg}`)
      }
    })

    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)
    return () => {
      disposed = true
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 地图铺满窗口，左侧面板和顶部场景栏悬浮在上面：设置地图留白，让居中和缩放都落在没被遮住的区域。
  // 收起或展开面板（App 发出 workspace-layout）时：镜头空闲就把画面中心平滑移到新的可见区域中央；
  // 镜头正在移动（例如切换场景触发的取景，它已按新的留白计算）就不打断，等停下后只换留白、画面不动。
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const applyInsets = () => map.setPadding(overlayInsets())
    const keepView = () => {
      const next = overlayInsets()
      const { clientWidth: w, clientHeight: h } = map.getContainer()
      const center = map.unproject([next.left + (w - next.left - next.right) / 2, next.top + (h - next.top - next.bottom) / 2])
      map.jumpTo({ center, padding: next })
    }
    const relayout = () => {
      map.off('moveend', keepView)
      if (map.isMoving()) map.once('moveend', keepView)
      else map.easeTo({ padding: overlayInsets(), duration: 450 })
    }
    applyInsets()
    window.addEventListener('resize', applyInsets)
    window.addEventListener('workspace-layout', relayout)
    return () => {
      window.removeEventListener('resize', applyInsets)
      window.removeEventListener('workspace-layout', relayout)
      map.off('moveend', keepView)
    }
  }, [mapReady])

  // 新增起点时把视野移过去；只在数量增加时移动，手动平移后不被拉回
  const prevOriginCountRef = useRef(0)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const grew = origins.length > prevOriginCountRef.current
    prevOriginCountRef.current = origins.length
    if (!grew) return
    const last = origins[origins.length - 1]
    if (last) map.flyTo({ center: last.lngLat, zoom: 12 })
  }, [origins])

  // 起点作为 GeoJSON point 更新到 Mapbox source；图标由 symbol layer 绘制。
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getSource(ORIGIN_POINTS_SOURCE) || draggingRef.current) return
    ;(map.getSource(ORIGIN_POINTS_SOURCE) as mapboxgl.GeoJSONSource)
      .setData(buildOriginPointCollection(origins))
  }, [mapReady, origins])

  // 各点原始等时圈：半透明铺底
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getSource('result-iso')) return
    const features: PolyFeature[] = []
    for (const o of origins) {
      if (!o.visible) continue
      const thresholds = bandMode === 'paired' ? globalThresholds : o.thresholds.slice(0, 1)
      // 先画范围较大的浅色层，再画范围较小的深色层，边界不会被外圈盖住。
      for (const minutes of [...thresholds].sort((a, b) => b - a)) {
        const geom = geoms.get(cellKey(o.id, minutes))
        if (!geom) continue
        features.push({
          ...geom,
          properties: {
            ...geom.properties,
            color: o.color,
            minutes,
            fillOpacity: originBandOpacity(thresholds, minutes),
            lineOpacity: originBandLineOpacity(thresholds, minutes),
            lineWidth: originBandLineWidth(thresholds, minutes),
          },
        })
      }
    }
    ;(map.getSource('origins-iso') as mapboxgl.GeoJSONSource)
      .setData({ type: 'FeatureCollection', features })
  }, [origins, geoms, bandMode, globalThresholds, mapReady])

  // 运算结果：高对比压在最上层
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getSource('result-iso')) return
    const features: PolyFeature[] = []

    // 单点结果和它自己的等时圈完全相同，重复铺一层紫色只会抹掉点位颜色。
    if (visibleIds.length >= 2) {
      for (const { minutes, result: r } of [...resultItems].sort((a, b) => b.minutes - a.minutes)) {
        if (r.kind === 'ok') {
          const lineWidth = resultBandLineWidth(resultBands, minutes)
          features.push({
            ...r.geometry,
            properties: {
              ...r.geometry.properties,
              minutes,
              fillOpacity: resultBandOpacity(resultBands, minutes),
              lineWidth,
              casingDash: resultCasingDash(lineWidth),
            },
          })
        }
      }
    }

    ;(map.getSource('result-iso') as mapboxgl.GeoJSONSource)
      .setData({ type: 'FeatureCollection', features })

    // 有合成结果时稍微压低单点填色，但保留足够浓度和强描边，让用户仍能
    // 从地图追溯每一个点；旧版降到 0.05，实际几乎看不见。
    const hasResult = features.length > 0
    map.setPaintProperty('origins-fill', 'fill-opacity', [
      '*', ['coalesce', ['get', 'fillOpacity'], 0.18], hasResult ? 0.62 : 1,
    ])
    map.setPaintProperty('origins-line', 'line-opacity', [
      '*', ['coalesce', ['get', 'lineOpacity'], 0.8], hasResult ? 0.88 : 1,
    ])
  }, [mapReady, resultBands, resultItems, visibleIds.length])

  return (
    <div className="map-view-wrap">
      <div className="map-view" ref={containerRef} />
      {scene === 'explore' && explorePicking && <div className="picking-hint">点击地图标记探索起点<button onClick={() => useExplore.setState({ picking: false })}>取消</button></div>}
      {scene === 'commute' && commuteView === 'range' && rangeStatus === 'ok' && !commutePicking && <div className="range-map-caption">
        <strong>{RANGE_LABELS[rangeMode]} · {rangeMinutes} 分钟圈</strong><span>{rangeMode === 'subway-walking' ? '到达工作地 · 地铁＋步行' : '从工作地出发 · 通勤参考'}</span>
      </div>}

      {scene === 'commute' && commutePicking && <div className="picking-hint">
        点击地图标记{commutePicking === 'work' ? '公司' : '候选住处'}
        <button onClick={() => useCommute.getState().setPicking(null)}>取消</button>
      </div>}

      {scene === 'isochrone' && pickingMode && (
        <div className="picking-hint">
          点击地图选择起点
          <button onClick={() => setPickingMode(false)}>取消</button>
        </div>
      )}

      {!isMobile && scene === 'isochrone' && (
        <ResultsPanel
          variant="overlay"
          allOrigins={origins}
          visibleOrigins={visibleOrigins}
          bands={resultBands}
          results={resultItems}
          op={op}
          collapsed={resultsCollapsed}
          onToggleCollapsed={() => setResultsCollapsed((collapsed) => !collapsed)}
        />
      )}

      <button
        className={locating ? 'locate-btn is-locating' : 'locate-btn'}
        onClick={() => void handleLocate()}
        disabled={locating}
        aria-busy={locating}
        title={locating ? '正在定位…' : '定位到我的位置'}
        aria-label={locating ? '正在定位' : '定位到我的位置'}
      >
        <LocateIcon />
      </button>

      {locateMsg && (
        <div className="locate-msg">
          {locateMsg}
          <button onClick={() => setLocateMsg(null)}>知道了</button>
        </div>
      )}
    </div>
  )
}
