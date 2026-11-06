import { expect, it } from 'vitest'
import { getProvider } from './index'

it('地铁分发到本地引擎，停用公交 ArrivalRange，其他方式保持可用', () => {
  expect(getProvider('subway-walking').id).toBe('local-metro-walking-v1')
  expect(() => getProvider('transit-walking')).toThrow('已停用')
  for (const mode of ['driving', 'walking', 'cycling'] as const) expect(getProvider(mode).id).toBe('mapbox')
})
