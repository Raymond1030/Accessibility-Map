import { describe, it, expect, vi } from 'vitest'
import { polygon, booleanPointInPolygon, point } from '@turf/turf'
import { createMetroWalkingProvider, metroRangeInfo } from './metroWalking'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { MetroNetwork } from '../transit/types'
import { metroMapFeatures } from '../transit/mapFeatures'

const network: MetroNetwork = {
  city: 'test', crs: 'WGS-84', generatedAt: '2026-08-14',
  defaults: { headwayMin: 5, boardMin: 2, exitMin: 2, transferMin: 4, dwellMin: 0, runSpeedKmph: 35 },
  lines: [{ id: '1', name: '1号线', runTimesMin: [4, 4], stations: [
    { id: 'a', name: 'A', lngLat: [114, 22.5] },
    { id: 'b', name: 'B', lngLat: [114.1, 22.5] },
    { id: 'c', name: 'C', lngLat: [114.102, 22.5] }, // B/C 距离近但接驳不可擅自合并
  ] }],
}
const req: IsochroneRequest = { mode: 'subway-walking', lngLat: [114, 22.5], minutes: 30, direction: 'arrive' }
function setup(net = network) {
  const fetch = vi.fn(async ({ lngLat: [x, y] }: IsochroneRequest) => polygon([
    [[x-.0005,y-.0005],[x+.0005,y-.0005],[x+.0005,y+.0005],[x-.0005,y+.0005],[x-.0005,y-.0005]],
  ]))
  const leg: IsochroneProvider = { id: 'test-walking', supportedModes: ['walking'], fetch }
  return { fetch, provider: createMetroWalkingProvider({ leg, network: net }) }
}

describe('本地地铁等时圈', () => {
  it('反向地铁成本分配步行预算，远端和相邻车站均保留，不画凸包填满站间区域', async () => {
    const { fetch, provider } = setup()
    const result = await provider.fetch(req)
    const info = metroRangeInfo(result)!
    expect(info.engine).toBe('local-metro-dijkstra')
    expect(info.direction).toBe('arrive')
    expect(info.stations.map(s => [s.id, s.walkMinutes])).toEqual([['a',15],['b',15],['c',13]])
    expect(fetch).toHaveBeenCalledWith({ lngLat: [114.102,22.5], mode: 'walking', minutes: 13 })
    expect(result!.geometry.type).toBe('MultiPolygon')
    expect(booleanPointInPolygon(point([114.05,22.5]), result!)).toBe(false)
    expect(booleanPointInPolygon(point([114.102,22.5]), result!)).toBe(true)
    const map = metroMapFeatures(info, network)
    expect(map.features.filter(f => f.geometry.type === 'Point')).toHaveLength(3)
    expect(map.features.filter(f => f.geometry.type === 'LineString')).toHaveLength(2)
  })
  it('不够坐地铁的短时间仍保留纯步行区', async () => {
    const { provider } = setup()
    const result = await provider.fetch({ ...req, minutes: 1 })
    expect(result).not.toBeNull()
    expect(metroRangeInfo(result)?.stations).toEqual([])
  })
  it('支持多点页面的出发方向，和租房到达方向分开', async () => {
    const { provider } = setup()
    expect(metroRangeInfo(await provider.fetch({ ...req, direction: undefined }))?.direction).toBe('depart')
  })
  it('外地和非法时间明确报错，不使用几何半径作替代', async () => {
    const { provider, fetch } = setup()
    await expect(provider.fetch({ ...req, lngLat: [116.4,39.9] })).rejects.toThrow('仅覆盖深圳')
    await expect(provider.fetch({ ...req, minutes: 61 })).rejects.toThrow('1–60')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('任一车站路网请求失败则整体失败，不能返回残缺成功结果', async () => {
    const { provider, fetch } = setup()
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation(async r => {
      if (r.lngLat[0] > 114.09) throw new Error('路网服务不可用')
      return original(r)
    })
    await expect(provider.fetch(req)).rejects.toThrow('路网服务不可用')
  })
  it('取消后不再启动车站步行请求', async () => {
    const { provider, fetch } = setup()
    const controller = new AbortController()
    await expect(provider.fetch({ ...req, signal: controller.signal, onProgress: message => {
      if (message.startsWith('地铁寻路完成')) controller.abort()
    } })).rejects.toThrow()
    expect(fetch.mock.calls.every(([r]) => r.lngLat[0] === 114)).toBe(true)
  })
})
