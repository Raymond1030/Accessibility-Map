import { describe, expect, it } from 'vitest'
import {
  MARKER_ICON_OPTIONS,
  markerIconSrc,
  markerShowsCode,
  resolveMarkerIcon,
} from './markerIcons'

describe('marker icon presets', () => {
  it('提供不重复的预设选项', () => {
    const ids = MARKER_ICON_OPTIONS.map((option) => option.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('place')
  })

  it('旧地点数据默认使用通用地点图标', () => {
    expect(resolveMarkerIcon(undefined)).toBe('place')
  })

  it('每个选项都有各自的彩色图标，未知值回退到地点的图标', () => {
    // 小于内联阈值的 SVG 会被 Vite 内联成 data: URL，这里只要求非空且各不相同
    const sources = MARKER_ICON_OPTIONS.map((option) => markerIconSrc(option.id))
    expect(sources.every((src) => typeof src === 'string' && src.length > 0)).toBe(true)
    expect(new Set(sources).size).toBe(sources.length)
    expect(markerIconSrc(undefined)).toBe(markerIconSrc('place'))
  })

  it('只有通用「地点」直接显示字母代号，其他类型画图标', () => {
    expect(markerShowsCode(undefined)).toBe(true)
    expect(markerShowsCode('place')).toBe(true)
    expect(markerShowsCode('medical')).toBe(false)
    expect(markerShowsCode('home')).toBe(false)
  })
})
