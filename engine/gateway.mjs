import { createServer } from 'node:http'

const profiles = { walking: 'foot', cycling: 'bike', driving: 'car' }
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
function invalid(message) { throw new ApiError(400, 'INVALID_REQUEST', message) }
function missing(message) { throw new ApiError(422, 'DATA_UNAVAILABLE', message) }

export function activeService(summary, date) {
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T12:00:00Z`).getUTCDay()]
  const services = new Set(summary.calendars.filter(c => c.start_date <= date && c.end_date >= date && c[weekday] === '1').map(c => c.service_id))
  for (const exception of summary.exceptions) {
    if (exception.date !== date) continue
    if (exception.exception_type === '1') services.add(exception.service_id)
    if (exception.exception_type === '2') services.delete(exception.service_id)
  }
  return services.size > 0
}

function serviceAt(summary, time) {
  return summary.timezones.some(timeZone => {
    const fields = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(time)
    const part = key => fields.find(p => p.type === key).value
    const date = part('year') + part('month') + part('day')
    if (activeService(summary, date)) return true
    // A 24:xx departure belongs to the previous service day. Do not carry it into an unrelated evening.
    const maxHours = summary.maxServiceHours ?? summary.maxStopTimeHours
    for (let daysBack = 1; daysBack <= Math.floor(maxHours / 24); daysBack++) {
      if (Number(part('hour')) > maxHours - daysBack * 24 + 1) continue
      const day = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`)
      day.setUTCDate(day.getUTCDate() - daysBack)
      if (activeService(summary, day.toISOString().slice(0, 10).replaceAll('-', ''))) return true
    }
    return false
  })
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180
  const lat = (a[1] + b[1]) / 2 * rad
  return 6371000 * Math.hypot((a[0] - b[0]) * rad * Math.cos(lat), (a[1] - b[1]) * rad)
}

export function buildQuery(input, manifest, upstream = 'http://127.0.0.1:8989') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('请求必须是 JSON 对象。')
  const { lngLat, minutes, mode, direction = 'depart' } = input
  if (!Array.isArray(lngLat) || lngLat.length !== 2 || !lngLat.every(Number.isFinite) || Math.abs(lngLat[0]) > 180 || Math.abs(lngLat[1]) > 90) invalid('lngLat 须为 WGS-84 [经度, 纬度]。')
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) invalid('时间须为 1–60 整数分钟。')
  if (!['depart', 'arrive'].includes(direction)) invalid('direction 须为 depart 或 arrive。')
  if (typeof mode !== 'string' || (!Object.hasOwn(profiles, mode) && mode !== 'transit-walking')) invalid('本地模式支持步行、骑行、静态驾车和已导入 GTFS 的公交；不提供实时路况。')
  const [west, south, east, north] = manifest.bbox
  if (lngLat[0] < west || lngLat[0] > east || lngLat[1] < south || lngLat[1] > north) missing(`位置超出已加载的${manifest.label}路网范围。`)
  const url = new URL(mode === 'transit-walking' ? '/isochrone-pt' : '/isochrone', upstream)
  url.searchParams.set('point', `${lngLat[1]},${lngLat[0]}`)
  url.searchParams.set('time_limit', String(minutes * 60))
  url.searchParams.set('reverse_flow', String(direction === 'arrive'))
  if (mode === 'transit-walking') {
    if (!manifest.gtfs.length) missing('当前区域没有导入 GTFS，公交班次数据不可用。')
    if (typeof input.dateTime !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.dateTime) || !Number.isFinite(Date.parse(input.dateTime))) invalid('公交查询必须提供带时区的 dateTime，例如 2026-11-07T08:00:00+08:00。')
    const time = new Date(input.dateTime)
    // The walking/transit window can intersect another service day even when no stop time exceeds 24:00.
    const otherEnd = new Date(time.getTime() + (direction === 'arrive' ? -1 : 1) * minutes * 60000)
    const dated = manifest.gtfs.filter(feed => serviceAt(feed.summary, time) || serviceAt(feed.summary, otherEnd))
    if (!dated.length) missing('查询日期没有已导入的公交服务；请更新 GTFS 或改选服务日期。')
    // Conservative origin coverage gate; absence is a data gap, not a claim of no transit in the city.
    if (!dated.some(feed => feed.summary.stopCoordinates.some(stop => distanceMeters(lngLat, stop) <= 2500))) missing('附近 2.5 公里没有已导入 GTFS 的站点；当地公交数据尚未覆盖。')
    url.searchParams.set('pt.earliest_departure_time', time.toISOString())
    url.searchParams.set('result', 'multipolygon')
  } else {
    url.searchParams.set('profile', profiles[mode])
    url.searchParams.set('buckets', '1')
  }
  return url
}

export function publicSources(manifest) {
  return {
    engine: manifest.engine.name, engineVersion: manifest.engine.version, region: manifest.region,
    label: manifest.label, dataVersion: manifest.dataVersion, bbox: manifest.bbox,
    osm: { url: manifest.osm.url, sha256: manifest.osm.sha256, downloadedAt: manifest.osm.downloadedAt, attribution: manifest.osm.attribution },
    transit: manifest.gtfs.map(feed => ({ id: feed.id, url: feed.url, sha256: feed.sha256, downloadedAt: feed.downloadedAt,
      attribution: feed.attribution, limitations: feed.limitations, stops: feed.summary.stops, routes: feed.summary.routes,
      routeTypes: feed.summary.routeTypes, hasRail: feed.summary.hasRail, serviceStart: feed.summary.serviceStart,
      serviceEnd: feed.summary.serviceEnd, frequencyRows: feed.summary.frequencyRows })),
    limitations: manifest.limitations,
  }
}

async function readBody(req) {
  const parts = []
  let bytes = 0
  for await (const part of req) {
    bytes += part.length
    if (bytes > 8192) throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求过大。')
    parts.push(part)
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { invalid('请求正文不是有效 JSON。') }
}

function allowedOrigin(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) }
  catch { return false }
}

export function createGateway({ manifest, upstream = 'http://127.0.0.1:8989', isReady = () => false, timeoutMs = 65000 }) {
  let active = 0
  const sources = publicSources(manifest)
  return createServer(async (req, res) => {
    const send = (status, data) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    try {
      const origin = req.headers.origin
      if (origin && !allowedOrigin(origin)) throw new ApiError(403, 'ORIGIN_DENIED', '请通过本机页面访问本地引擎。')
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
      const path = new URL(req.url, 'http://localhost').pathname
      if (req.method === 'GET' && path === '/sources') return send(200, sources)
      if (req.method === 'GET' && path === '/health') {
        if (!isReady()) return send(503, { status: 'starting', ...sources })
        const response = await fetch(upstream + '/info', { signal: AbortSignal.timeout(2000) }).catch(() => null)
        return send(response?.ok ? 200 : 503, { status: response?.ok ? 'ready' : 'unavailable', ...sources })
      }
      if (req.method !== 'POST' || path !== '/isochrone') return send(404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } })
      if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'CONTENT_TYPE', '请使用 application/json。')
      const input = await readBody(req)
      const url = buildQuery(input, manifest, upstream)
      if (!isReady()) throw new ApiError(503, 'ENGINE_STARTING', '本地引擎正在建图或尚未就绪，请查看引擎终端。')
      if (active >= 1) throw new ApiError(429, 'ENGINE_BUSY', '本地计算队列繁忙，请稍后重试。')
      active++
      // Aborting an HTTP socket does not cancel GraphHopper's CPU work. Keep the slot
      // until the upstream request actually finishes, including after client cancellation.
      const timeout = setTimeout(() => send(504, { error: { code: 'ENGINE_TIMEOUT', message: '本地计算超时，请缩短时长后重试；后台搜索结束前引擎仍会显示繁忙。' } }), timeoutMs)
      try {
        const response = await fetch(url)
        const raw = await response.json().catch(() => null)
        if (!response.ok) throw new ApiError(response.status === 400 ? 422 : 502, 'UPSTREAM_ERROR', '路网计算失败：' + (raw?.message || `HTTP ${response.status}`))
        if (!Array.isArray(raw?.polygons) || raw.polygons.some(f => f.type !== 'Feature' || !['Polygon', 'MultiPolygon'].includes(f.geometry?.type) || !Array.isArray(f.geometry.coordinates))) throw new ApiError(502, 'INVALID_RESPONSE', '引擎返回了无效的等时圈。')
        const metadata = { ...sources, mode: input.mode, minutes: input.minutes, direction: input.direction ?? 'depart', dateTime: input.dateTime ?? null }
        return send(200, { type: 'FeatureCollection', features: raw.polygons.filter(f => f.geometry.coordinates.length).map(f => ({ ...f, properties: { ...f.properties, localEngine: metadata } })), metadata })
      } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(503, 'ENGINE_UNAVAILABLE', '无法连接本地路由引擎，请检查启动日志。')
      } finally {
        active--
        clearTimeout(timeout)
      }
    } catch (error) {
      send(error.status ?? 500, { error: { code: error.code ?? 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : '本地服务处理失败，请检查终端日志。' } })
      if (!(error instanceof ApiError)) console.error(error)
    }
  })
}
