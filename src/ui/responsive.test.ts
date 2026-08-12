import { describe, it, expect } from 'vitest'
import { shouldAddOnMapClick, MOBILE_BREAKPOINT, MOBILE_MEDIA_QUERY } from './responsive'

describe('shouldAddOnMapClick', () => {
  it('桌面端直接点地图就能加点，与选点模式无关', () => {
    expect(shouldAddOnMapClick(false, false)).toBe(true)
    expect(shouldAddOnMapClick(false, true)).toBe(true)
  })

  it('移动端未进入选点模式时不加点——否则拖动地图、收抽屉都会误触', () => {
    expect(shouldAddOnMapClick(true, false)).toBe(false)
  })

  it('移动端进入选点模式后才加点', () => {
    expect(shouldAddOnMapClick(true, true)).toBe(true)
  })
})

describe('断点常量', () => {
  it('断点是 768', () => {
    expect(MOBILE_BREAKPOINT).toBe(768)
  })

  it('媒体查询串由断点派生，避免两处写死后不同步', () => {
    expect(MOBILE_MEDIA_QUERY).toBe('(max-width: 768px)')
  })
})
