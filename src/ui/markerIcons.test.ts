import { describe, expect, it } from 'vitest'
import {
  MARKER_ICON_OPTIONS,
  markerIconImageId,
  markerIconMarkup,
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
    expect(markerIconImageId(undefined)).toBe('origin-symbol-place')
    expect(markerIconMarkup(undefined)).toContain('<circle')
  })
})
