import { describe, expect, it } from 'vitest'
import {
  RANGE_DASH,
  RESULT_CASING_EXTRA,
  casingDash,
  colorWithAlpha,
  contrastText,
  originBandOpacity,
  originCode,
  resultBandLineWidth,
  resultBandOpacity,
  resultCasingDash,
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

  it('范围边界用与首页案例卡片相同的虚线：画 3、空 2（线宽为单位）', () => {
    expect(RANGE_DASH).toEqual([3, 2])
  })

  it('结果轮廓的白色衬线与紫色虚线逐段对齐', () => {
    const widths = [2.8, ...[[30], [15, 30, 45], [15, 30, 45, 60]].flatMap(bands => bands.map(m => resultBandLineWidth(bands, m)))]
    for (const w of widths) {
      const [dash, gap] = resultCasingDash(w)
      const casing = w + RESULT_CASING_EXTRA
      // Mapbox 把虚线长度乘以各自的线宽：两层的每一段画线、每一段空隙都必须一样长
      expect(dash * casing).toBeCloseTo(RANGE_DASH[0] * w, 12)
      expect(gap * casing).toBeCloseTo(RANGE_DASH[1] * w, 12)
    }
  })

  it('任意宽度的白色衬线（如通勤范围 2.5 / 5 像素）都与彩色虚线逐段对齐', () => {
    for (const [line, casing] of [[2.5, 5], [1.5, 4], [3, 7.25]]) {
      const [dash, gap] = casingDash(line, casing)
      expect(dash * casing).toBeCloseTo(RANGE_DASH[0] * line, 12)
      expect(gap * casing).toBeCloseTo(RANGE_DASH[1] * line, 12)
    }
  })
})
