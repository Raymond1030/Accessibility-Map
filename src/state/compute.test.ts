import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import {
  planRequests,
  computeBand,
  computeCustomBand,
  applyCustomThreshold,
  normalizeCustomThresholds,
} from './compute'
import type { Origin } from '../types'
import type { PolyFeature } from '../geometry/ops'
import type { CellStatus } from '../geometry/result'

function square(x: number, y: number, size = 1): PolyFeature {
  return polygon([[
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ]]) as PolyFeature
}

const origin = (id: string, over: Partial<Origin> = {}): Origin => ({
  id,
  label: id,
  lngLat: [116.397, 39.909],
  mode: 'driving',
  thresholds: [30],
  color: '#e4572e',
  visible: true,
  ...over,
})

describe('planRequests', () => {
  it('同档模式下每点都用全局档位', () => {
    const plan = planRequests([origin('a'), origin('b')], 'paired', [15, 30])
    expect(plan).toHaveLength(4)
    expect(plan.map((p) => p.minutes).sort()).toEqual([15, 15, 30, 30])
  })

  it('自定义模式下每点用自己的档位', () => {
    const plan = planRequests(
      [origin('a', { thresholds: [15] }), origin('b', { thresholds: [45] })],
      'custom',
      [30],
    )
    expect(plan.map((p) => p.minutes).sort()).toEqual([15, 45])
  })

  it('自定义模式即使遇到旧的多档数据也只请求第一档', () => {
    const plan = planRequests(
      [origin('a', { thresholds: [15, 30, 45] })],
      'custom',
      [15, 30, 45],
    )
    expect(plan.map((p) => p.minutes)).toEqual([15])
  })

  it('跳过隐藏的起点', () => {
    const plan = planRequests([origin('a'), origin('b', { visible: false })], 'paired', [30])
    expect(plan).toHaveLength(1)
    expect(plan[0].originId).toBe('a')
  })

  it('去掉超过 60 分钟上限的档位', () => {
    const plan = planRequests([origin('a')], 'paired', [30, 90])
    expect(plan.map((p) => p.minutes)).toEqual([30])
  })

  it('没有可见起点时得到空计划', () => {
    expect(planRequests([origin('a', { visible: false })], 'paired', [30])).toHaveLength(0)
  })
})

describe('applyCustomThreshold', () => {
  it('换档时旧的自定义档被替换，预设档不受影响', () => {
    expect(applyCustomThreshold([15, 20, 30], 20, 25)).toEqual([15, 25, 30])
  })

  it('旧档不在场时直接加入新档并保持有序', () => {
    expect(applyCustomThreshold([15, 30], 20, 25)).toEqual([15, 25, 30])
  })

  it('新档与已有档重合时不产生重复', () => {
    expect(applyCustomThreshold([15, 20, 30], 20, 30)).toEqual([15, 30])
  })
})

describe('computeBand', () => {
  const geoms = new Map<string, PolyFeature | null>([
    ['a@30', square(0, 0, 2)],
    ['b@30', square(1, 1, 2)],
  ])
  const okCells = new Map<string, CellStatus>([['a@30', 'ok'], ['b@30', 'ok']])

  it('交集重叠时返回带面积的结果', () => {
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms, baseOriginId: null,
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.areaSqM).toBeGreaterThan(0)
  })

  it('交集为空时返回 empty 而非错误', () => {
    const far = new Map<string, PolyFeature | null>([
      ['a@30', square(0, 0)], ['b@30', square(50, 50)],
    ])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms: far, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'empty' })
  })

  it('某点该档失败时整档不可用，且不用残缺点集运算', () => {
    const broken = new Map<string, CellStatus>([['a@30', 'ok'], ['b@30', 'error']])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: broken, geoms, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'unavailable', missing: ['b'] })
  })

  it('某点无公交覆盖时，交集正确地为空', () => {
    const withEmpty = new Map<string, CellStatus>([['a@30', 'ok'], ['b@30', 'empty']])
    const geomsWithNull = new Map<string, PolyFeature | null>([
      ['a@30', square(0, 0, 2)], ['b@30', null],
    ])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: withEmpty, geoms: geomsWithNull, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'empty' })
  })

  it('并集在某点无覆盖时仍返回另一点的范围', () => {
    const withEmpty = new Map<string, CellStatus>([['a@30', 'ok'], ['b@30', 'empty']])
    const geomsWithNull = new Map<string, PolyFeature | null>([
      ['a@30', square(0, 0, 2)], ['b@30', null],
    ])
    const r = computeBand({
      op: 'union', minutes: 30, originIds: ['a', 'b'],
      cells: withEmpty, geoms: geomsWithNull, baseOriginId: null,
    })
    expect(r.kind).toBe('ok')
  })

  it('差集用指定的基准点', () => {
    const r = computeBand({
      op: 'difference', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms, baseOriginId: 'a',
    })
    expect(r.kind).toBe('ok')
  })

  it('差集缺少基准点时不可用', () => {
    const r = computeBand({
      op: 'difference', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms, baseOriginId: null,
    })
    expect(r.kind).toBe('unavailable')
  })

  it('单个起点直接给出它自己的可达范围——不需要凑够两个点才有结果', () => {
    const one = new Map<string, PolyFeature | null>([['a@30', square(0, 0, 2)]])
    const oneCell = new Map<string, CellStatus>([['a@30', 'ok']])
    for (const op of ['intersect', 'union', 'difference'] as const) {
      const r = computeBand({
        op, minutes: 30, originIds: ['a'],
        cells: oneCell, geoms: one, baseOriginId: 'a',
      })
      expect(r.kind, `${op} 单点应有结果`).toBe('ok')
      if (r.kind === 'ok') expect(r.areaSqM).toBeGreaterThan(0)
    }
  })

  it('单个起点无公交覆盖时结果为空，而非报错', () => {
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a'],
      cells: new Map<string, CellStatus>([['a@30', 'empty']]),
      geoms: new Map<string, PolyFeature | null>([['a@30', null]]),
      baseOriginId: 'a',
    })
    expect(r).toEqual({ kind: 'empty' })
  })

  it('仍在加载时返回 loading', () => {
    const loading = new Map<string, CellStatus>([['a@30', 'ok'], ['b@30', 'loading']])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: loading, geoms, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'loading' })
  })
})

describe('normalizeCustomThresholds', () => {
  it('把多档数据收敛为第一个时间', () => {
    expect(normalizeCustomThresholds([15, 30, 45])).toEqual([15])
  })

  it('无旧数据时使用指定的默认时间', () => {
    expect(normalizeCustomThresholds([], 20)).toEqual([20])
  })
})

describe('computeCustomBand', () => {
  it('按每个起点各自的时间取数据并运算', () => {
    const r = computeCustomBand({
      op: 'intersect',
      originIds: ['a', 'b'],
      minutesByOrigin: new Map([['a', 15], ['b', 45]]),
      cells: new Map<string, CellStatus>([['a@15', 'ok'], ['b@45', 'ok']]),
      geoms: new Map<string, PolyFeature | null>([
        ['a@15', square(0, 0, 2)],
        ['b@45', square(1, 1, 2)],
      ]),
      baseOriginId: null,
    })

    expect(r.kind).toBe('ok')
  })

  it('不会错用另一起点的时间档位', () => {
    const r = computeCustomBand({
      op: 'intersect',
      originIds: ['a', 'b'],
      minutesByOrigin: new Map([['a', 15], ['b', 45]]),
      cells: new Map<string, CellStatus>([['a@15', 'ok'], ['b@15', 'ok']]),
      geoms: new Map<string, PolyFeature | null>([
        ['a@15', square(0, 0, 2)],
        ['b@15', square(1, 1, 2)],
      ]),
      baseOriginId: null,
    })

    expect(r).toEqual({ kind: 'unavailable', missing: ['b'] })
  })
})
