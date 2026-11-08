import { describe, expect, it } from 'vitest'
import { originMarkerImageId, parseOriginMarkerImageId } from './originMarker'

describe('origin marker image id', () => {
  it('颜色、图标、代号编进 id 后能原样解析回来', () => {
    const id = originMarkerImageId('#1769D2', 'medical', 'A')
    expect(parseOriginMarkerImageId(id)).toEqual({ color: '#1769D2', icon: 'medical', code: 'A' })
  })

  it('两位数代号也能解析', () => {
    expect(parseOriginMarkerImageId(originMarkerImageId('#DE4D2A', 'home', '27'))?.code).toBe('27')
  })

  it('旧数据缺图标或图标未知时回退到通用地点', () => {
    expect(originMarkerImageId('#1769D2', undefined, 'B')).toBe('origin-marker:#1769D2:place:B')
    expect(parseOriginMarkerImageId('origin-marker:#1769D2:rocket:B')?.icon).toBe('place')
  })

  it('不认领底图自带的图标 id', () => {
    expect(parseOriginMarkerImageId('hospital-15')).toBeNull()
    expect(parseOriginMarkerImageId('origin-marker:#1769D2:place')).toBeNull()
    expect(parseOriginMarkerImageId('origin-marker::place:A')).toBeNull()
  })
})
