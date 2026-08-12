import { useEffect, useRef } from 'react'
import { loadAmap } from '../amap/loader'
import { useStore } from '../state/store'
import { cellKey } from '../types'
import { computeBand } from '../state/compute'
import { shouldAddOnMapClick, useIsMobile } from '../ui/responsive'
import type { PolyFeature } from '../geometry/ops'
import './MapView.css'

/** GeoJSON 环 → 高德 path。坐标已经是 GCJ-02，直接用 */
function ringsOf(f: PolyFeature): number[][][] {
  return f.geometry.type === 'Polygon'
    ? [f.geometry.coordinates[0] as number[][]]
    : (f.geometry.coordinates as number[][][][]).map((poly) => poly[0] as number[][])
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const originLayerRef = useRef<any[]>([])
  const resultLayerRef = useRef<any[]>([])
  const markerRef = useRef<any[]>([])

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

  // 建图的 effect 只跑一次，click 闭包会锁死首次渲染的 isMobile/pickingMode。
  // 用 ref 让回调始终读到当前值。
  const clickGuardRef = useRef({ isMobile: false, picking: false })
  clickGuardRef.current = { isMobile, picking: pickingMode }

  // 建图，只做一次
  useEffect(() => {
    let disposed = false
    loadAmap()
      .then((AMapNS) => {
        if (disposed || !containerRef.current) return
        const map = new AMapNS.Map(containerRef.current, {
          zoom: 11,
          center: [116.397, 39.909],
          viewMode: '2D',
        })
        map.on('click', (e: any) => {
          const { isMobile: mob, picking } = clickGuardRef.current
          if (!shouldAddOnMapClick(mob, picking)) return
          addOrigin([e.lnglat.getLng(), e.lnglat.getLat()], '')
        })
        mapRef.current = map
      })
      .catch((err) => setFatalError(err instanceof Error ? err.message : String(err)))
    return () => {
      disposed = true
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [addOrigin, setFatalError])

  // 高德不会自己感知容器尺寸变化，旋转屏幕后地图会拉伸
  useEffect(() => {
    const onResize = () => mapRef.current?.resize?.()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 新增起点时把视野移过去。
  // 不这样的话，在深圳搜个点、地图却还停在默认的北京——加点后收起抽屉
  // 本是为了让人看等时圈，结果看到的是一片无关区域。
  // 只在「起点变多」时移动：用户手动平移缩放后不该被强行拉回。
  const prevOriginCountRef = useRef(0)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const grew = origins.length > prevOriginCountRef.current
    prevOriginCountRef.current = origins.length
    if (!grew) return
    const last = origins[origins.length - 1]
    if (last) map.setZoomAndCenter(12, last.lngLat)
  }, [origins])

  // 起点标记，可拖拽；dragend 才触发重算，dragging 不触发
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current.forEach((m) => map.remove(m))
    markerRef.current = origins.map((o) => {
      const marker = new (window as any).AMap.Marker({
        position: o.lngLat,
        draggable: true,
        title: o.label,
      })
      marker.on('dragend', (e: any) => {
        updateOrigin(o.id, { lngLat: [e.lnglat.getLng(), e.lnglat.getLat()] })
      })
      map.add(marker)
      return marker
    })
  }, [origins, updateOrigin])

  // 各点原始等时圈：半透明铺底
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    originLayerRef.current.forEach((p) => map.remove(p))
    originLayerRef.current = []

    for (const o of origins) {
      if (!o.visible) continue
      const thresholds = bandMode === 'paired' ? globalThresholds : o.thresholds
      for (const minutes of thresholds) {
        const geom = geoms.get(cellKey(o.id, minutes))
        if (!geom) continue
        for (const ring of ringsOf(geom)) {
          const poly = new (window as any).AMap.Polygon({
            path: ring,
            fillColor: o.color,
            fillOpacity: 0.12,
            strokeColor: o.color,
            strokeOpacity: 0.5,
            strokeWeight: 1,
          })
          map.add(poly)
          originLayerRef.current.push(poly)
        }
      }
    }
  }, [origins, geoms, bandMode, globalThresholds])

  // 运算结果：高对比压在最上层
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    resultLayerRef.current.forEach((p) => map.remove(p))
    resultLayerRef.current = []

    const visibleIds = origins.filter((o) => o.visible).map((o) => o.id)
    // 单个起点也要画结果层——那时它就是这个点自己的可达范围
    if (visibleIds.length < 1) return
    const bands = bandMode === 'paired' ? globalThresholds : [globalThresholds[0]]

    for (const minutes of bands) {
      const r = computeBand({ op, minutes, originIds: visibleIds, cells, geoms, baseOriginId })
      if (r.kind !== 'ok') continue
      for (const ring of ringsOf(r.geometry)) {
        const poly = new (window as any).AMap.Polygon({
          path: ring,
          fillColor: '#111827',
          fillOpacity: 0.3,
          strokeColor: '#f59e0b',
          strokeWeight: 3,
          zIndex: 100,
        })
        map.add(poly)
        resultLayerRef.current.push(poly)
      }
    }
  }, [origins, cells, geoms, op, bandMode, globalThresholds, baseOriginId])

  return (
    <div className="map-view-wrap">
      <div className="map-view" ref={containerRef} />
      {pickingMode && (
        <div className="picking-hint">
          点击地图选择起点
          <button onClick={() => setPickingMode(false)}>取消</button>
        </div>
      )}
    </div>
  )
}
