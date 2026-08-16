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
  RESULT_COLOR,
  originCode,
  originBandLineOpacity,
  originBandLineWidth,
  originBandOpacity,
  resultBandLineWidth,
  resultBandOpacity,
} from '../ui/mapStyle'
import {
  MARKER_ICON_OPTIONS,
  createMarkerIconImage,
  markerIconImageId,
} from '../ui/markerIcons'
import type { PolyFeature } from '../geometry/ops'
import type { FeatureCollection, Point } from 'geojson'
import './MapView.css'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const ORIGIN_POINTS_SOURCE = 'origin-points'
const ORIGIN_POINT_HIT_LAYER = 'origin-point-hit'
const ORIGIN_SYMBOL_LAYER = 'origin-symbols'

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
        iconImage: markerIconImageId(origin.markerIcon),
        code: originCode(index),
        color: origin.color,
        visible: origin.visible,
      },
      geometry: { type: 'Point', coordinates: origin.lngLat },
    })),
  }
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
      addOrigin(r.lngLat, '我的位置')
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

    const canvas = map.getCanvasContainer()

    const moveDraggedPoint = (event: mapboxgl.MapLayerMouseEvent | mapboxgl.MapLayerTouchEvent) => {
      const dragging = draggingRef.current
      if (!dragging) return
      const lngLat: [number, number] = [event.lngLat.lng, event.lngLat.lat]
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
      const originId = event.features?.[0]?.properties?.originId
      if (typeof originId !== 'string') return false
      const origin = originsRef.current.find((candidate) => candidate.id === originId)
      if (!origin) return false
      event.preventDefault()
      draggingRef.current = {
        originId,
        data: buildOriginPointCollection(originsRef.current),
        lngLat: [...origin.lngLat],
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

      // Mapbox symbol layer 只引用 style image。预设 SVG 路径先绘制为高 DPI
      // ImageData，再按官方 addImage 流程注册，不再创建 DOM Marker。
      for (const option of MARKER_ICON_OPTIONS) {
        const imageId = markerIconImageId(option.id)
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, createMarkerIconImage(option.id), { pixelRatio: 2 })
        }
      }

      // 每个 feature 自带与侧栏图例一致的透明度和线宽：近时段更浓，
      // 远时段更淡。不要在这里另写常量，否则图例会和地图失配。
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
        },
      })
      // 紫色只表示「多个点的集合运算结果」。单点不画这一层，保留点本身
      // 的识别色。白色 casing 让结果边界在道路、水面和绿地上都能读清。
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
          'line-width': ['+', ['coalesce', ['get', 'lineWidth'], 2.8], 3.4],
          'line-opacity': 0.94,
        },
      })
      map.addLayer({
        id: 'result-line',
        type: 'line',
        source: 'result-iso',
        paint: {
          'line-color': RESULT_COLOR,
          'line-width': ['coalesce', ['get', 'lineWidth'], 2.8],
          'line-opacity': 0.98,
        },
      })

      // circle 提供每个地点的数据驱动颜色和更宽的拖拽命中区；真正的图标
      // 由上方 symbol layer 的 icon-image 表达式绘制。
      map.addLayer({
        id: ORIGIN_POINT_HIT_LAYER,
        type: 'circle',
        source: ORIGIN_POINTS_SOURCE,
        paint: {
          'circle-radius': 19,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
          'circle-opacity': ['case', ['get', 'visible'], 0.96, 0.46],
          'circle-stroke-opacity': ['case', ['get', 'visible'], 1, 0.58],
        },
      })
      map.addLayer({
        id: ORIGIN_SYMBOL_LAYER,
        type: 'symbol',
        source: ORIGIN_POINTS_SOURCE,
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-size': 0.92,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'code'],
          'text-size': 10,
          'text-offset': [1.55, -1.55],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'icon-opacity': ['case', ['get', 'visible'], 1, 0.5],
          'text-color': ['get', 'color'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2.5,
          'text-opacity': ['case', ['get', 'visible'], 1, 0.58],
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
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!map || !mapReady || draggingRef.current) return
    ;(map.getSource(ORIGIN_POINTS_SOURCE) as mapboxgl.GeoJSONSource)
      .setData(buildOriginPointCollection(origins))
  }, [mapReady, origins])

  // 各点原始等时圈：半透明铺底
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
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
    if (!map || !mapReady) return
    const features: PolyFeature[] = []

    // 单点结果和它自己的等时圈完全相同，重复铺一层紫色只会抹掉点位颜色。
    if (visibleIds.length >= 2) {
      for (const { minutes, result: r } of [...resultItems].sort((a, b) => b.minutes - a.minutes)) {
        if (r.kind === 'ok') {
          features.push({
            ...r.geometry,
            properties: {
              ...r.geometry.properties,
              minutes,
              fillOpacity: resultBandOpacity(resultBands, minutes),
              lineWidth: resultBandLineWidth(resultBands, minutes),
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

      {pickingMode && (
        <div className="picking-hint">
          点击地图选择起点
          <button onClick={() => setPickingMode(false)}>取消</button>
        </div>
      )}

      {!isMobile && (
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
        className="locate-btn"
        onClick={() => void handleLocate()}
        disabled={locating}
        title="定位到我的位置"
        aria-label="定位到我的位置"
      >
        {locating ? '···' : '◎'}
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
