/**
 * 桌面端的控制面板悬浮在地图左侧，场景切换栏悬浮在顶部；地图本身铺满整个窗口。
 * 镜头取景（居中、缩放到路线或范围）要避开这些悬浮层，否则地点和范围会被面板挡住。
 * 手机端面板是底部抽屉，各处取景另外加底部留白，这里返回 0。
 */
export type Insets = { top: number; right: number; bottom: number; left: number }

/**
 * 只读布局位置（offset*，相对于和地图同一个定位容器），不受 transform 影响：
 * 面板滑入、滑出或播放入场动画的途中量到的仍是它停稳后的位置。
 */
type LayoutBox = { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number }
type BoxSource = { querySelector(selector: string): unknown }

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
export const MOBILE_MAX_WIDTH = 768

export function overlayInsets(
  doc: BoxSource = document,
  viewportWidth: number = window.innerWidth,
): Insets {
  if (viewportWidth <= MOBILE_MAX_WIDTH) return ZERO
  // 收起的面板滑出了屏幕，不再遮挡地图
  const panel = doc.querySelector('.workspace-panel:not(.is-collapsed)') as LayoutBox | null
  const nav = doc.querySelector('.scene-switch') as LayoutBox | null
  return {
    top: nav ? Math.max(0, nav.offsetTop + nav.offsetHeight) : 0,
    right: 0,
    bottom: 0,
    left: panel ? Math.max(0, panel.offsetLeft + panel.offsetWidth) : 0,
  }
}

/** 把悬浮层占用的区域叠加到某次取景本来要留的边距上。 */
export function withOverlayInsets(padding: Insets, insets: Insets = overlayInsets()): Insets {
  return {
    top: padding.top + insets.top,
    right: padding.right + insets.right,
    bottom: padding.bottom + insets.bottom,
    left: padding.left + insets.left,
  }
}
