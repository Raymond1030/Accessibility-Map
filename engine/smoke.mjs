import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { area } from '@turf/turf'

const base = process.env.LOCAL_ENGINE_URL || 'http://127.0.0.1:8787'
const response = await fetch(base + '/health', { signal: AbortSignal.timeout(3000) })
const health = await response.json()
assert.equal(response.status, 200, 'Engine must be ready before smoke test')
assert.equal(health.status, 'ready')
const points = { guangdong: [['guangzhou', [113.2644,23.1291]], ['shenzhen', [114.0579,22.5431]], ['hong-kong', [114.1722,22.2988]], ['macau', [113.539,22.194]]],
  'hong-kong': [['hong-kong', [114.1722,22.2988]]], macau: [['macau', [113.539,22.194]]] }
const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10)
const cases = points[health.region].flatMap(([name, lngLat]) => ['walking', 'cycling', 'driving'].map(mode => ({ name, lngLat, mode, minutes: 15, direction: 'arrive' })))
if (health.transit.length) {
  for (const direction of ['depart', 'arrive']) cases.push({ name: 'hong-kong-transit', lngLat: [114.1722,22.2988], mode: 'transit-walking', minutes: 30, direction, dateTime: `${date}T08:00:00+08:00` })
}
const output = join(dirname(fileURLToPath(import.meta.url)), '.local', 'evidence', health.dataVersion)
await mkdir(output, { recursive: true })
const results = []
for (const { name, ...query } of cases) {
  const started = performance.now()
  const res = await fetch(base + '/isochrone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal: AbortSignal.timeout(90000) })
  const body = await res.json()
  const elapsedMs = Math.round(performance.now() - started)
  const file = `${name}-${query.mode}-${query.direction}.geojson`
  await writeFile(join(output, file), JSON.stringify(body))
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal(body.type, 'FeatureCollection')
  assert.ok(body.features.length > 0, `${name} must yield a real polygon`)
  const areaSqKm = area(body) / 1e6
  assert.ok(Number.isFinite(areaSqKm) && areaSqKm > 0)
  const record = { name, query, elapsedMs, areaSqKm: Number(areaSqKm.toFixed(4)), features: body.features.length, file }
  results.push(record)
  console.log(JSON.stringify(record))
}
const negativeCases = [{ name: 'invalid-minutes', query: { ...cases[0], minutes: 0 }, status: 400, code: 'INVALID_REQUEST' }]
if (health.transit.length && health.transit.every(feed => feed.id === 'hk-td')) {
  negativeCases.push({ name: 'expired-service', query: { lngLat: [114.1722,22.2988], mode: 'transit-walking', minutes: 30, dateTime: '2100-01-02T08:00:00+08:00' }, status: 422, code: 'DATA_UNAVAILABLE' })
  if (health.region === 'guangdong') {
    for (const [name, lngLat] of [['shenzhen-transit-gap', [114.0579,22.5431]], ['macau-transit-gap', [113.539,22.194]]]) {
      negativeCases.push({ name, query: { lngLat, mode: 'transit-walking', minutes: 30, dateTime: `${date}T08:00:00+08:00` }, status: 422, code: 'DATA_UNAVAILABLE' })
    }
  }
}
for (const item of negativeCases) {
  const res = await fetch(base + '/isochrone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.query), signal: AbortSignal.timeout(5000) })
  const body = await res.json()
  assert.equal(res.status, item.status, item.name)
  assert.equal(body.error?.code, item.code, item.name)
  item.message = body.error.message
}
const report = { testedAt: new Date().toISOString(), sources: health, results, negativeCases }
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(`PASS: ${results.length} real queries, ${negativeCases.length} expected errors. Evidence: ${output}`)
