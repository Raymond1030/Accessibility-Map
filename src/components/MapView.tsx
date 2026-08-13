import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getMapboxToken } from '../mapbox/token'
import { useStore } from '../state/store'
import { cellKey } from '../types'
import { computeBand } from '../state/compute'
import { shouldAddOnMapClick, useIsMobile } from '../ui/responsive'
import { locateCurrentPosition } from '../geo/locate'
import type { PolyFeature } from '../geometry/ops'
import type { FeatureCollection } from 'geojson'
import './MapView.css'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

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
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [mapReady, setMapReady] = useState(false)

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

    map.on('load', () => {
      // source/layer 必须在 load 后添加。两个空 source，渲染 effect 只 setData
      map.addSource('origins-iso', { type: 'geojson', data: EMPTY_FC })
      map.addSource('result-iso', { type: 'geojson', data: EMPTY_FC })

      // 档位是有序数据：嵌套的三档圈叠加后内圈自然更深（15 分钟被三层
      // 覆盖），透明度选 0.15 让三层叠加(≈0.39)仍不遮死底图。
      // 描边提亮，否则档位边界糊成一片。
      map.addLayer({
        id: 'origins-fill',
        type: 'fill',
        source: 'origins-iso',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'origins-line',
        type: 'line',
        source: 'origins-iso',
        paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.65, 'line-width': 1.2 },
      })
      // 结果层专用 violet——与全部起点色经验证距离安全，且在底图上
      // 无冲突（水是蓝、绿地是绿、道路是橙黄，紫色不与任何底色抢戏）。
      // 白色衬线（casing）压在紫线下面，保证边界在任何底色上都清晰——
      // 旧版的近黑填充在彩色底图上像一块污渍。
      map.addLayer({
        id: 'result-fill',
        type: 'fill',
        source: 'result-iso',
        paint: { 'fill-color': '#4a3aa7', 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: 'result-casing',
        type: 'line',
        source: 'result-iso',
        paint: { 'line-color': '#ffffff', 'line-width': 4.5, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'result-line',
        type: 'line',
        source: 'result-iso',
        paint: { 'line-color': '#4a3aa7', 'line-width': 2 },
      })

      setMapReady(true)
    })

    map.on('click', (e) => {
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

  // 起点标记，可拖拽；dragend 才触发重算
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = origins.map((o) => {
      const marker = new mapboxgl.Marker({ draggable: true, color: o.color })
        .setLngLat(o.lngLat)
        .addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLngLat()
        updateOrigin(o.id, { lngLat: [p.lng, p.lat] })
      })
      return marker
    })
  }, [origins, updateOrigin])

  // 各点原始等时圈：半透明铺底
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const features: PolyFeature[] = []
    for (const o of origins) {
      if (!o.visible) continue
      const thresholds = bandMode === 'paired' ? globalThresholds : o.thresholds
      for (const minutes of thresholds) {
        const geom = geoms.get(cellKey(o.id, minutes))
        if (!geom) continue
        features.push({ ...geom, properties: { ...geom.properties, color: o.color } })
      }
    }
    ;(map.getSource('origins-iso') as mapboxgl.GeoJSONSource)
      .setData({ type: 'FeatureCollection', features })
  }, [origins, geoms, bandMode, globalThresholds, mapReady])

  // 运算结果：高对比压在最上层
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const visibleIds = origins.filter((o) => o.visible).map((o) => o.id)
    const features: PolyFeature[] = []

    if (visibleIds.length >= 1) {
      const bands = bandMode === 'paired' ? globalThresholds : [globalThresholds[0]]
      for (const minutes of bands) {
        const r = computeBand({ op, minutes, originIds: visibleIds, cells, geoms, baseOriginId })
        if (r.kind === 'ok') features.push(r.geometry)
      }
    }

    ;(map.getSource('result-iso') as mapboxgl.GeoJSONSource)
      .setData({ type: 'FeatureCollection', features })
  }, [origins, cells, geoms, op, bandMode, globalThresholds, baseOriginId, mapReady])

  return (
    <div className="map-view-wrap">
      <div className="map-view" ref={containerRef} />

      {pickingMode && (
        <div className="picking-hint">
          点击地图选择起点
          <button onClick={() => setPickingMode(false)}>取消</button>
        </div>
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
