import { describe, expect, it } from 'vitest'
import { CATEGORIES } from './types'
import { CATEGORY_ICON, categoryIcon } from './categoryIcons'

describe('生活探索类别图标', () => {
  it('每个类别都有各自的彩色图标', () => {
    const sources = CATEGORIES.map((category) => CATEGORY_ICON[category.id])
    expect(sources.every((src) => typeof src === 'string' && src.length > 0)).toBe(true)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('不认识的类别返回 undefined，让地图标记退回只写编号', () => {
    expect(categoryIcon('park')).toBe(CATEGORY_ICON.park)
    expect(categoryIcon('spaceport')).toBeUndefined()
    expect(categoryIcon(undefined)).toBeUndefined()
  })
})
