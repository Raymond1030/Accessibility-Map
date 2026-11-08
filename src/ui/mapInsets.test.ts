import { describe, expect, it } from 'vitest'
import { overlayInsets, withOverlayInsets } from './mapInsets'

function fakeDoc(rects: Record<string, { right: number; bottom: number }>) {
  return {
    querySelector: (selector: string) => (rects[selector] ? { getBoundingClientRect: () => rects[selector] } : null),
  }
}

describe('悬浮面板的取景留白', () => {
  it('桌面端避开左侧面板和顶部场景栏', () => {
    const doc = fakeDoc({ '.workspace-panel': { right: 404.4, bottom: 888 }, '.scene-switch': { right: 900, bottom: 62.6 } })
    expect(overlayInsets(doc, 1440)).toEqual({ top: 63, right: 0, bottom: 0, left: 404 })
  })

  it('手机端面板是底部抽屉，不额外留白', () => {
    const doc = fakeDoc({ '.workspace-panel': { right: 375, bottom: 800 } })
    expect(overlayInsets(doc, 375)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('页面上还没有面板时返回 0', () => {
    expect(overlayInsets(fakeDoc({}), 1280)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('叠加到某次取景本来的边距上', () => {
    expect(withOverlayInsets({ top: 70, right: 45, bottom: 60, left: 45 }, { top: 63, right: 0, bottom: 0, left: 404 }))
      .toEqual({ top: 133, right: 45, bottom: 60, left: 449 })
  })
})
