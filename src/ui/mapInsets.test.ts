import { describe, expect, it } from 'vitest'
import { overlayInsets, withOverlayInsets } from './mapInsets'

type Box = { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number }

function fakeDoc(boxes: Record<string, Box>) {
  return { querySelector: (selector: string) => boxes[selector] ?? null }
}

const PANEL = '.workspace-panel:not(.is-collapsed)'
const NAV = '.scene-switch'

describe('悬浮面板的取景留白', () => {
  it('桌面端避开左侧面板和顶部场景栏', () => {
    const doc = fakeDoc({
      [PANEL]: { offsetLeft: 12, offsetTop: 12, offsetWidth: 392, offsetHeight: 876 },
      [NAV]: { offsetLeft: 805, offsetTop: 12, offsetWidth: 290, offsetHeight: 48 },
    })
    expect(overlayInsets(doc, 1440)).toEqual({ top: 60, right: 0, bottom: 0, left: 404 })
  })

  it('手机端面板是底部抽屉，不额外留白', () => {
    const doc = fakeDoc({ [PANEL]: { offsetLeft: 0, offsetTop: 0, offsetWidth: 375, offsetHeight: 800 } })
    expect(overlayInsets(doc, 375)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('面板收起后只避开顶部场景栏', () => {
    const doc = fakeDoc({ [NAV]: { offsetLeft: 575, offsetTop: 12, offsetWidth: 290, offsetHeight: 48 } })
    expect(overlayInsets(doc, 1440)).toEqual({ top: 60, right: 0, bottom: 0, left: 0 })
  })

  it('页面上还没有面板时返回 0', () => {
    expect(overlayInsets(fakeDoc({}), 1280)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('叠加到某次取景本来的边距上', () => {
    expect(withOverlayInsets({ top: 70, right: 45, bottom: 60, left: 45 }, { top: 63, right: 0, bottom: 0, left: 404 }))
      .toEqual({ top: 133, right: 45, bottom: 60, left: 449 })
  })
})
