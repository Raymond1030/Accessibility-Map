import { describe, it, expect } from 'vitest'
import { buildGraph, metroReachability } from './graph'
import type { MetroNetwork } from './types'

/**
 * 两条线的玩具网络，站距约 1.1 公里（0.01 度纬差）：
 *
 *   A线： a1 — a2 — a3 — a4     （水平）
 *   B线：       b1(=a2 同名换乘) — b2 — b3   （垂直）
 *
 * runTimesMin 显式给 A 线，B 线留空走距离估算。
 */
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
        { id: 'b3', name: 'B三', lngLat: [114.01, 22.52] },
      ],
    },
  ],
}

describe('buildGraph', () => {
  const g = buildGraph(NET)

  it('每条线上的每个站是一个节点，含同名换乘站', () => {
    expect(g.nodes).toHaveLength(7)
    expect(g.byStationId.size).toBe(7)
  })

  it('区间边双向且含停站时间', () => {
    const a1 = g.byStationId.get('a1')!
    const a2 = g.byStationId.get('a2')!
    const edge = g.nodes[a1].edges.find(([to]) => to === a2)
    expect(edge?.[1]).toBeCloseTo(2 + 0.5)
    expect(g.nodes[a2].edges.some(([to]) => to === a1)).toBe(true)
  })

  it('无 runTimesMin 的线按距离估算区间用时', () => {
    const b1 = g.byStationId.get('b1')!
    const b2 = g.byStationId.get('b2')!
    const edge = g.nodes[b1].edges.find(([to]) => to === b2)!
    // 0.01 度纬差 ≈ 1.11 公里，33km/h ≈ 2.02 分钟 + 0.5 停站
    expect(edge[1]).toBeGreaterThan(2)
    expect(edge[1]).toBeLessThan(3.2)
  })

  it('同名跨线站之间有换乘边，代价含目标线候车', () => {
    const a2 = g.byStationId.get('a2')!
    const b1 = g.byStationId.get('b1')!
    const toB = g.nodes[a2].edges.find(([to]) => to === b1)!
    // 换乘走行 4 + B 线班距 6/2 = 7
    expect(toB[1]).toBeCloseTo(7)
    const toA = g.nodes[b1].edges.find(([to]) => to === a2)!
    // 反向换到 A 线：4 + 4/2 = 6
    expect(toA[1]).toBeCloseTo(6)
  })
})

describe('metroReachability', () => {
  const g = buildGraph(NET)

  it('从进站点沿线累加：接驳 + 进站 + 候车 + 区间', () => {
    // a1 进站：接驳 5 + 进站 2 + 候车 4/2 = 9；到 a2 再 +2.5 = 11.5
    const reached = metroReachability(g, [{ stationId: 'a1', accessMin: 5 }], 60, 2)
    expect(reached.get('a1')).toBeCloseTo(9)
    expect(reached.get('a2')).toBeCloseTo(11.5)
    expect(reached.get('a4')).toBeCloseTo(16.5)
  })

  it('跨线可达要吃换乘代价', () => {
    const reached = metroReachability(g, [{ stationId: 'a1', accessMin: 5 }], 60, 2)
    // a2 11.5 + 换乘 7 = b1 18.5，b2 再加约 2.5
    expect(reached.get('b1')).toBeCloseTo(18.5)
    expect(reached.get('b2')!).toBeGreaterThan(20)
  })

  it('预算截断：超出预算的站不出现', () => {
    const reached = metroReachability(g, [{ stationId: 'a1', accessMin: 5 }], 12, 2)
    expect(reached.has('a2')).toBe(true)
    expect(reached.has('a3')).toBe(false)
    expect(reached.has('b1')).toBe(false)
  })

  it('多源取最优：两个进站点各覆盖近端', () => {
    const reached = metroReachability(
      g,
      [{ stationId: 'a1', accessMin: 10 }, { stationId: 'a4', accessMin: 5 }],
      60,
      2,
    )
    // a4 从自己进站（5+2+2=9）远比从 a1 一路坐过来近
    expect(reached.get('a4')).toBeCloseTo(9)
    expect(reached.get('a1')).toBeCloseTo(14)
  })

  it('没有进站点时空手而归', () => {
    expect(metroReachability(g, [], 60, 2).size).toBe(0)
  })

  it('未知站点 id 被忽略而不是崩溃', () => {
    expect(metroReachability(g, [{ stationId: '不存在', accessMin: 5 }], 60, 2).size).toBe(0)
  })
})
