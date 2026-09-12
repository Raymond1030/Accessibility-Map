import { describe, expect, it } from 'vitest'
import { polygon } from '@turf/turf'
import { isEmptyConclusion, resultSummary, type ResultItem } from './ResultsPanel'
import type { PolyFeature } from '../geometry/ops'

const geometry = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

describe('resultSummary', () => {
  it('没有参与地点时引导添加地点', () => {
    expect(resultSummary(0, [], 'intersect')).toBe('添加一个地点开始')
  })

  it('优先显示第一个可用档位的面积', () => {
    const results: ResultItem[] = [
      { minutes: 15, result: { kind: 'loading' } },
      { minutes: 30, result: { kind: 'ok', geometry, areaSqM: 2_500_000 } },
    ]
    expect(resultSummary(2, results, 'intersect')).toBe('30 分钟 · 2.50 km²')
  })

  it('空交集保留其结论语义', () => {
    const results: ResultItem[] = [{ minutes: 15, result: { kind: 'empty' } }]
    expect(resultSummary(2, results, 'intersect')).toBe('15 分钟 · 无共同可达区')
  })

  it('分别设置不会冒充成某个统一时间', () => {
    const results: ResultItem[] = [{
      minutes: 15,
      label: '分别设置',
      minutesByOrigin: { a: 15, b: 45 },
      result: { kind: 'ok', geometry, areaSqM: 2_500_000 },
    }]
    expect(resultSummary(2, results, 'intersect')).toBe('分别设置 · 2.50 km²')
  })

  it('仍在加载时显示计算状态', () => {
    const results: ResultItem[] = [{ minutes: 15, result: { kind: 'loading' } }]
    expect(resultSummary(1, results, 'union')).toBe('正在计算可达范围')
  })

  it('无档位与数据不全使用不同文案', () => {
    expect(resultSummary(1, [], 'union')).toBe('选择时间档位')
    expect(resultSummary(1, [{ minutes: 15, result: { kind: 'unavailable', missing: ['a'] } }], 'union'))
      .toBe('数据不全，无法计算')
  })
})

describe('isEmptyConclusion', () => {
  it('只有空结果时突出结论', () => {
    expect(isEmptyConclusion([
      { minutes: 15, result: { kind: 'empty' } },
      { minutes: 30, result: { kind: 'loading' } },
    ])).toBe(true)
  })

  it('仍有可用档位时只突出对应的空结果行', () => {
    expect(isEmptyConclusion([
      { minutes: 15, result: { kind: 'empty' } },
      { minutes: 30, result: { kind: 'ok', geometry, areaSqM: 2_500_000 } },
    ])).toBe(false)
  })
})
