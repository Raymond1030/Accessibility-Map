import { describe, it, expect } from 'vitest'
import { formatArea, resolveBandStatus, type CellStatus } from './result'

/** 显式标注元素类型——否则 TS 会把 Map 推断成 Map<string, string>，tsc --noEmit 报错 */
const cells = (...entries: Array<[string, CellStatus]>) => new Map<string, CellStatus>(entries)

describe('formatArea', () => {
  it('大面积用平方公里', () => {
    expect(formatArea(12_400_000)).toBe('12.40 km²')
  })

  it('小面积用平方米', () => {
    expect(formatArea(8500)).toBe('8500 m²')
  })

  it('零面积', () => {
    expect(formatArea(0)).toBe('0 m²')
  })
})

describe('resolveBandStatus', () => {
  it('全部就绪时可以运算', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'ok']), ['a', 'b'])
    expect(status).toEqual({ kind: 'ready' })
  })

  it('任一点失败则整档不可用，并列出缺失来源', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'error']), ['a', 'b'])
    expect(status).toEqual({ kind: 'unavailable', missing: ['b'] })
  })

  it('某点该档尚未请求，同样视为不可用', () => {
    const status = resolveBandStatus(cells(['a', 'ok']), ['a', 'b'])
    expect(status).toEqual({ kind: 'unavailable', missing: ['b'] })
  })

  it('仍在加载时报告 loading 而非 unavailable', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'loading']), ['a', 'b'])
    expect(status).toEqual({ kind: 'loading' })
  })

  it('某点无公交覆盖是有效数据，不阻断运算', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'empty']), ['a', 'b'])
    expect(status).toEqual({ kind: 'ready' })
  })

  it('没有任何必需点时不可运算', () => {
    expect(resolveBandStatus(cells(), [])).toEqual({ kind: 'unavailable', missing: [] })
  })
})
