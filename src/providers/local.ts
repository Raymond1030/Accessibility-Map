import { normalize, type PolyFeature } from '../geometry/ops'
import type { IsochroneProvider } from './cache'
import { withGate } from './gate'

export function getLocalEngineUrl(): string | null {
  const value = String(import.meta.env.VITE_LOCAL_ENGINE_URL ?? '').trim()
  if (!value) return null
  let url: URL
  try { url = new URL(value) } catch { throw new Error('VITE_LOCAL_ENGINE_URL 必须是本机 HTTP 地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('本地引擎仅接受本机服务地址，例如 http://127.0.0.1:8787。')
  }
  return url.origin
}

export function isLocalEngineEnabled(): boolean { return getLocalEngineUrl() !== null }

function validPolygon(value: unknown): value is PolyFeature {
  if (!value || typeof value !== 'object') return false
  const f = value as PolyFeature
  if (f.type !== 'Feature' || !f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type)) return false
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]))
}

/** No permanent result cache: restarting the local server can load a different dataset. */
export function createLocalProvider(baseUrl: string): IsochroneProvider {
  const inner: IsochroneProvider = {
    id: 'local-graphhopper',
    supportedModes: ['walking', 'cycling', 'driving', 'transit-walking'],
    async fetch(req) {
      req.signal?.throwIfAborted()
      if (!inner.supportedModes.includes(req.mode)) throw new Error('本地引擎不支持此出行方式。')
      if (req.mode === 'transit-walking' && !req.dateTime) throw new Error('请选择公交查询时刻。')
      const controller = new AbortController()
      const cancel = () => controller.abort(req.signal?.reason)
      req.signal?.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(() => controller.abort(new Error('本地计算超时，请缩短时长后重试。')), 70000)
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/isochrone`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ lngLat: req.lngLat, mode: req.mode, minutes: req.minutes, direction: req.direction ?? 'depart', ...(req.dateTime ? { dateTime: req.dateTime } : {}) }),
        }).catch(error => {
          if (controller.signal.aborted) throw controller.signal.reason
          throw new Error(`无法连接本地引擎，请先运行 npm run engine:start。${error instanceof Error ? `（${error.message}）` : ''}`)
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error?.message ?? `本地引擎请求失败（HTTP ${response.status}）。`)
        if (body?.type !== 'FeatureCollection' || !Array.isArray(body.features) || !body.features.every(validPolygon)) throw new Error('本地引擎返回了无效的等时圈。')
        const result = normalize(body.features)
        if (result && body.metadata) result.properties = { ...result.properties, localEngine: body.metadata }
        return result
      } finally {
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', cancel)
      }
    },
  }
  return withGate(inner, { maxConcurrency: 1, retries: 0 })
}
