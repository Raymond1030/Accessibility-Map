import { afterEach, expect, it, vi } from 'vitest'
import { createLocalProvider, getLocalEngineUrl, isLocalEngineEnabled } from './local'
import { requestFingerprint } from './cache'
import type { IsochroneRequest } from './cache'

const request: IsochroneRequest = { lngLat: [114.17, 22.3], minutes: 15, mode: 'walking', direction: 'arrive' }
const feature = { type: 'Feature', properties: { localEngine: { dataVersion: 'v1' } }, geometry: { type: 'Polygon', coordinates: [[[114,22],[114.1,22],[114,22.1],[114,22]]] } }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('本地开关只接受本机地址，配置错误不静默关闭', () => {
  vi.stubEnv('VITE_LOCAL_ENGINE_URL', '')
  expect(isLocalEngineEnabled()).toBe(false)
  vi.stubEnv('VITE_LOCAL_ENGINE_URL', 'http://127.0.0.1:8787/')
  expect(getLocalEngineUrl()).toBe('http://127.0.0.1:8787')
  vi.stubEnv('VITE_LOCAL_ENGINE_URL', 'https://example.org')
  expect(() => getLocalEngineUrl()).toThrow('本机')
})

it('保留 WGS84 输入和到达方向，通过真实 JSON 契约取得本地来源', async () => {
  const controller = new AbortController()
  let body: unknown
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    expect(url).toBe('http://127.0.0.1:8787/isochrone')
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] }))
  }))
  const result = await createLocalProvider('http://127.0.0.1:8787').fetch({ ...request, signal: controller.signal })
  expect(body).toEqual({ lngLat: [114.17, 22.3], mode: 'walking', minutes: 15, direction: 'arrive' })
  expect(result?.properties?.localEngine.dataVersion).toBe('v1')
})

it('公交必须传显式时刻，两个班次时刻不能共用缓存指纹', async () => {
  const a = { ...request, mode: 'transit-walking' as const, dateTime: '2026-11-07T08:00:00+08:00' }
  const b = { ...a, dateTime: '2026-11-07T09:00:00+08:00' }
  expect(requestFingerprint('local', a)).not.toBe(requestFingerprint('local', b))
  await expect(createLocalProvider('http://localhost:8787').fetch({ ...request, mode: 'transit-walking' })).rejects.toThrow('时刻')
})

it('合法空圈、服务失败与无效响应分别处理', async () => {
  const provider = createLocalProvider('http://localhost:8787')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '当前区域没有 GTFS' } }), { status: 422 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [114, 22] } }] }))))
  await expect(provider.fetch(request)).resolves.toBeNull()
  await expect(provider.fetch(request)).rejects.toThrow('GTFS')
  await expect(provider.fetch(request)).rejects.toThrow('无效')
})

it('已取消请求不访问服务；同一坐标再次查询会读取当前图而非永久缓存', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] })))
  vi.stubGlobal('fetch', fetcher)
  const signal = AbortSignal.abort()
  await expect(createLocalProvider('http://localhost:8787').fetch({ ...request, signal })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] })))
  const provider = createLocalProvider('http://localhost:8787')
  await provider.fetch(request)
  await provider.fetch(request)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
