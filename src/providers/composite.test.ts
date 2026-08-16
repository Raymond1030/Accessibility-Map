import { describe, it, expect } from 'vitest'
import { booleanPointInPolygon, point, polygon } from '@turf/turf'
import { createCompositeProvider } from './composite'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'
import type { MetroNetwork } from '../transit/types'

/**
 * 假腿 provider：以请求点为中心返回边长 2×(minutes×0.0005°) 的正方形。
 * minutes 越大圈越大，且能精确断言每次腿级请求的参数。
 */
function fakeLeg(calls: IsochroneRequest[]): IsochroneProvider {
  return {
    id: 'fake-leg',
    supportedModes: ['cycling'],
    async fetch(req) {
      calls.push(req)
      const r = req.minutes * 0.0005
      const [cx, cy] = req.lngLat
      return polygon([[
        [cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx - r, cy - r],
      ]]) as PolyFeature
    },
  }
}

/** A 线四站一字排开，站距 0.01°（约 1 公里）；B 线在换乘站垂直分出一站 */
const NET: MetroNetwork = {
  city: 'test',
  crs: 'WGS-84',
  defaults: {
    headwayMin: 6, transferMin: 4, boardMin: 2, exitMin: 2, dwellMin: 0.5, runSpeedKmph: 33,
  },
  lines: [
    {
      id: 'A',
      name: 'A线',
      headwayMin: 4,
      stations: [
        { id: 'a1', name: '一站', lngLat: [114.00, 22.50] },
        { id: 'a2', name: '换乘站', lngLat: [114.01, 22.50] },
        { id: 'a3', name: '三站', lngLat: [114.02, 22.50] },
        { id: 'a4', name: '四站', lngLat: [114.03, 22.50] },
      ],
      runTimesMin: [2, 2, 2],
    },
    {
      id: 'B',
      name: 'B线',
      stations: [
        { id: 'b1', name: '换乘站', lngLat: [114.01, 22.50] },
        { id: 'b2', name: 'B二', lngLat: [114.01, 22.51] },
      ],
    },
  ],
}

const ORIGIN: [number, number] = [114.00, 22.50]

function make() {
  const calls: IsochroneRequest[] = []
  const provider = createCompositeProvider({ leg: fakeLeg(calls), network: NET })
  return { calls, provider }
}

describe('createCompositeProvider', () => {
  it('只认 metro-cycling', async () => {
    const { provider } = make()
    await expect(provider.fetch({ lngLat: ORIGIN, mode: 'walking', minutes: 30 }))
      .rejects.toThrow(/只支持地铁\+骑行/)
  })

  it('起点在线网覆盖范围外时快速失败，不发腿级请求', async () => {
    const { calls, provider } = make()
    await expect(provider.fetch({ lngLat: [100, 30], mode: 'metro-cycling', minutes: 30 }))
      .rejects.toThrow(/深圳/)
    expect(calls).toHaveLength(0)
  })

  it('直达区 + 每个可达站的接驳圈并成一个要素', async () => {
    const { provider } = make()
    const result = await provider.fetch({ lngLat: ORIGIN, mode: 'metro-cycling', minutes: 30 })
    expect(result).not.toBeNull()
    // a4（114.03）离起点 3 公里，直达圈（半径 0.015°）够不到，
    // 但坐地铁到 a4 后的接驳圈盖住了它旁边的点——这正是组合的意义
    expect(booleanPointInPolygon(point([114.032, 22.50]), result!)).toBe(true)
    // 起点本身当然可达
    expect(booleanPointInPolygon(point(ORIGIN), result!)).toBe(true)
  })

  it('腿级请求 = 直达区 + 进站档位圈 + 出站接驳圈（剩余时间向下分桶）', async () => {
    const { calls, provider } = make()
    await provider.fetch({ lngLat: ORIGIN, mode: 'metro-cycling', minutes: 30 })

    // 起点处：直达 30 + 进站档 5/10/15，外加 a1 自己的出站接驳圈——
    // a1 与起点同坐标，总耗时 9、剩 19 → 15 分档
    const atOrigin = calls.filter((c) => c.lngLat[0] === 114.00 && c.lngLat[1] === 22.50)
    expect(atOrigin.map((c) => c.minutes).sort((x, y) => x - y)).toEqual([5, 10, 15, 15, 30])

    // a1 进站（5 分钟档），总耗时 5+2+4/2=9：
    //   a2 11.5 → 剩 16.5 → 15 分档；a3 14 → 剩 14 → 10 分档；a4 16.5 → 剩 11.5 → 10 分档
    const at = (lng: number, lat: number) =>
      calls.filter((c) => c.lngLat[0] === lng && c.lngLat[1] === lat && c.minutes !== 30)
    expect(at(114.02, 22.50).map((c) => c.minutes)).toEqual([10])
    expect(at(114.03, 22.50).map((c) => c.minutes)).toEqual([10])
  })

  it('同名换乘站在同一位置只发一个接驳圈请求', async () => {
    const { calls, provider } = make()
    await provider.fetch({ lngLat: ORIGIN, mode: 'metro-cycling', minutes: 30 })
    // a2 与 b1 坐标相同，去重后只剩一个请求（取更大的档）
    const atTransfer = calls.filter((c) => c.lngLat[0] === 114.01 && c.lngLat[1] === 22.50)
    expect(atTransfer).toHaveLength(1)
    expect(atTransfer[0].minutes).toBe(15)
  })

  it('预算太小进不了地铁时退化为纯直达区', async () => {
    const { calls, provider } = make()
    const result = await provider.fetch({ lngLat: ORIGIN, mode: 'metro-cycling', minutes: 10 })
    expect(result).not.toBeNull()
    // 只有直达 10 + 进站档 5——a1 进站后总耗时 9，剩 10-9-2 < 0，没有出站请求
    expect(calls.map((c) => c.minutes).sort((x, y) => x - y)).toEqual([5, 10])
  })

  it('腿级请求失败时整体失败（等时圈不能悄悄缺一块）', async () => {
    const failing: IsochroneProvider = {
      id: 'failing',
      supportedModes: ['cycling'],
      async fetch() { throw new Error('网络错误') },
    }
    const provider = createCompositeProvider({ leg: failing, network: NET })
    await expect(provider.fetch({ lngLat: ORIGIN, mode: 'metro-cycling', minutes: 30 }))
      .rejects.toThrow('网络错误')
  })
})
