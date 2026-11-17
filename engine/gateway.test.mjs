import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createGateway, buildQuery, activeService } from './gateway.mjs'

const manifest = {
  region: 'hong-kong', label: '香港', dataVersion: 'test-version', bbox: [113.8, 22.1, 114.5, 22.6],
  engine: { name: 'GraphHopper', version: '11.0' }, osm: { sha256: 'osm', attribution: 'OSM' }, limitations: [],
  gtfs: [{ id: 'hk-td', sha256: 'gtfs', limitations: ['不含港铁重铁'], summary: {
    stops: 2, routes: 1, trips: 1, routeTypes: { '3': 1 }, hasRail: false, timezones: ['Asia/Hong_Kong'],
    serviceStart: '20261101', serviceEnd: '20261130', maxStopTimeHours: 24, stopCoordinates: [[114.17, 22.3]],
    calendars: [{ service_id: 's', start_date: '20261101', end_date: '20261130', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '0', sunday: '0' }],
    exceptions: [{ service_id: 's', date: '20261107', exception_type: '1' }, { service_id: 's', date: '20261109', exception_type: '2' }],
  } }],
}
const request = { lngLat: [114.17, 22.3], mode: 'walking', minutes: 15, direction: 'arrive' }
const polygon = { type: 'Feature', properties: { bucket: 0 }, geometry: { type: 'Polygon', coordinates: [[[114.17,22.3],[114.18,22.3],[114.17,22.31],[114.17,22.3]]] } }

test('road query swaps coordinates, converts minutes, and respects reverse direction', () => {
  const url = buildQuery(request, manifest, 'http://127.0.0.1:8989')
  assert.equal(url.pathname, '/isochrone')
  assert.equal(url.searchParams.get('point'), '22.3,114.17')
  assert.equal(url.searchParams.get('time_limit'), '900')
  assert.equal(url.searchParams.get('reverse_flow'), 'true')
  assert.equal(url.searchParams.get('profile'), 'foot')
})

test('rejects malformed inputs and unavailable realtime traffic instead of falling back', () => {
  for (const change of [{ minutes: 0 }, { minutes: 61 }, { minutes: NaN }, { lngLat: [22.3, 114.17] }, { direction: 'back' }, { mode: 'driving-traffic' }, { mode: 'toString' }, { mode: '__proto__' }, { mode: ['walking'] }, { lngLat: [113.26, 23.13] }]) {
    assert.throws(() => buildQuery({ ...request, ...change }, manifest), error => error.status === 400 || error.status === 422)
  }
})

test('transit requires timezone and an available feed and keeps arrival time', () => {
  const query = { ...request, mode: 'transit-walking', dateTime: '2026-11-07T08:00:00+08:00' }
  const url = buildQuery(query, manifest)
  assert.equal(url.pathname, '/isochrone-pt')
  assert.equal(url.searchParams.get('pt.earliest_departure_time'), '2026-11-07T00:00:00.000Z')
  assert.equal(url.searchParams.get('reverse_flow'), 'true')
  assert.throws(() => buildQuery({ ...query, dateTime: '2026-11-07T08:00' }, manifest), /时区/)
  assert.throws(() => buildQuery(query, { ...manifest, gtfs: [] }), /GTFS/)
  assert.throws(() => buildQuery({ ...query, dateTime: '2027-01-01T08:00:00+08:00' }, manifest), /日期/)
  assert.throws(() => buildQuery({ ...query, lngLat: [114.45, 22.5] }, manifest), /站点/)
})

test('service calendar honors weekday, added and removed dates', () => {
  const feed = manifest.gtfs[0].summary
  assert.equal(activeService(feed, '20261106'), true)
  assert.equal(activeService(feed, '20261107'), true)
  assert.equal(activeService(feed, '20261108'), false)
  assert.equal(activeService(feed, '20261109'), false)
})

test('transit coverage considers the travel window across midnight in both directions', () => {
  const summary = { ...manifest.gtfs[0].summary, maxStopTimeHours: 23, exceptions: [], calendars: [{ ...manifest.gtfs[0].summary.calendars[0], tuesday: '0', wednesday: '0', thursday: '0', friday: '0' }] }
  const data = { ...manifest, gtfs: [{ ...manifest.gtfs[0], summary }] }
  const query = { ...request, mode: 'transit-walking', minutes: 30 }
  assert.doesNotThrow(() => buildQuery({ ...query, direction: 'arrive', dateTime: '2026-11-10T00:10:00+08:00' }, data))
  assert.doesNotThrow(() => buildQuery({ ...query, direction: 'depart', dateTime: '2026-11-08T23:50:00+08:00' }, data))
  assert.throws(() => buildQuery({ ...query, direction: 'arrive', dateTime: '2026-11-10T12:00:00+08:00' }, data), /日期/)
  const extended = { ...data, gtfs: [{ ...data.gtfs[0], summary: { ...summary, maxServiceHours: 27 } }] }
  assert.doesNotThrow(() => buildQuery({ ...query, direction: 'depart', dateTime: '2026-11-10T02:00:00+08:00' }, extended))
})

test('real HTTP boundary preserves provenance and errors and rejects untrusted origins', async t => {
  let upstreamStatus = 200
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url.startsWith('/info')) return res.end(JSON.stringify({ bbox: manifest.bbox, profiles: [{ name: 'foot' }] }))
    res.statusCode = upstreamStatus
    res.end(JSON.stringify(upstreamStatus === 200 ? { polygons: [polygon] } : { message: 'graph failed' }))
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const gateway = createGateway({ manifest, upstream: `http://127.0.0.1:${upstream.address().port}`, isReady: () => true }).listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  t.after(() => { gateway.closeAllConnections(); upstream.closeAllConnections(); gateway.close(); upstream.close() })
  const base = `http://127.0.0.1:${gateway.address().port}`
  const send = (body, origin = 'http://localhost:5173') => fetch(base + '/isochrone', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  const response = await send(request)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.features[0].geometry.type, 'Polygon')
  assert.equal(result.metadata.dataVersion, 'test-version')
  assert.equal(result.features[0].properties.localEngine.direction, 'arrive')
  assert.equal((await send(request, 'https://evil.example')).status, 403)
  upstreamStatus = 500
  const failed = await send(request)
  assert.equal(failed.status, 502)
  assert.equal((await failed.json()).error.code, 'UPSTREAM_ERROR')
})

test('a process that has not loaded its graph is never reported healthy', async t => {
  const gateway = createGateway({ manifest, isReady: () => false }).listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  t.after(() => { gateway.closeAllConnections(); gateway.close() })
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/health`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).status, 'starting')
})

test('only one graph search runs at a time to bound GTFS memory use', async t => {
  let reached, release
  const started = new Promise(resolve => { reached = resolve })
  const upstream = createServer((_req, res) => {
    release = () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ polygons: [polygon] })) }
    reached()
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const gateway = createGateway({ manifest, upstream: `http://127.0.0.1:${upstream.address().port}`, isReady: () => true }).listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  t.after(() => { gateway.closeAllConnections(); upstream.closeAllConnections(); gateway.close(); upstream.close() })
  const send = () => fetch(`http://127.0.0.1:${gateway.address().port}/isochrone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  const first = send()
  await started
  const second = await Promise.race([send(), new Promise(resolve => setTimeout(() => resolve({ status: 'accepted extra search' }), 100))])
  assert.equal(second.status, 429)
  release()
  assert.equal((await first).status, 200)
})

test('a timed-out HTTP request retains the search slot until GraphHopper finishes', async t => {
  let finish
  const upstream = createServer((_req, res) => {
    finish = () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ polygons: [polygon] })) }
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const gateway = createGateway({ manifest, upstream: `http://127.0.0.1:${upstream.address().port}`, isReady: () => true, timeoutMs: 30 }).listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  t.after(() => { gateway.closeAllConnections(); upstream.closeAllConnections(); gateway.close(); upstream.close() })
  const send = () => fetch(`http://127.0.0.1:${gateway.address().port}/isochrone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  assert.equal((await send()).status, 504)
  const second = await send()
  finish()
  assert.equal(second.status, 429)
})
