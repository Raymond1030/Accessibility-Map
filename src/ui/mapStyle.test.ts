import { describe, expect, it } from 'vitest'
import {
  colorWithAlpha,
  contrastText,
  originBandOpacity,
  originCode,
  resultBandOpacity,
} from './mapStyle'

describe('地图视觉编码', () => {
  it('时间越短填色越浓，侧栏与地图可复用同一数值', () => {
    const bands = [15, 30, 45]
    expect(originBandOpacity(bands, 15)).toBeGreaterThan(originBandOpacity(bands, 30))
    expect(originBandOpacity(bands, 30)).toBeGreaterThan(originBandOpacity(bands, 45))
    expect(resultBandOpacity(bands, 15)).toBeGreaterThan(resultBandOpacity(bands, 45))
  })

  it('单个时间档保持中等浓度，不会浓到遮住底图', () => {
    expect(originBandOpacity([30], 30)).toBeCloseTo(0.209, 3)
  })

  it('颜色能转换成图例使用的 rgba', () => {
    expect(colorWithAlpha('#1769D2', 0.2)).toBe('rgba(23, 105, 210, 0.2)')
  })

  it('亮色标记使用深色文字，深色标记使用白字', () => {
    expect(contrastText('#B87500')).toBe('#17233b')
    expect(contrastText('#1769D2')).toBe('#ffffff')
  })

  it('前 26 个点使用字母，之后退回数字', () => {
    expect(originCode(0)).toBe('A')
    expect(originCode(25)).toBe('Z')
    expect(originCode(26)).toBe('27')
  })
})
