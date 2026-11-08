import { afterEach, expect, it, vi } from 'vitest'
import { getProvider } from './index'

afterEach(() => vi.unstubAllEnvs())

it('地铁分发到本地引擎，停用公交 ArrivalRange，其他方式保持可用', () => {
  expect(getProvider('subway-walking').id).toBe('local-metro-walking-v1')
  expect(() => getProvider('transit-walking')).toThrow('已停用')
  for (const mode of ['driving', 'walking', 'cycling'] as const) expect(getProvider(mode).id).toBe('mapbox')
})

it('启用本地模式后路网与公交走 GraphHopper，实时路况明确不支持', () => {
  vi.stubEnv('VITE_LOCAL_ENGINE_URL', 'http://127.0.0.1:8787')
  for (const mode of ['driving', 'walking', 'cycling', 'transit-walking'] as const) expect(getProvider(mode).id).toBe('local-graphhopper')
  expect(() => getProvider('driving-traffic')).toThrow('实时')
  expect(getProvider('subway-walking').id).toBe('local-metro-walking-v1')
})
