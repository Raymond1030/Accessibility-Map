import type { MarkerIcon } from '../types'
import { contrastText } from './mapStyle'
import { markerIconImage, markerShowsCode, resolveMarkerIcon } from './markerIcons'

/**
 * 「多点见面」地图上的出发地标记：白底圆角方块，不描边，只靠两层柔和投影和底图分开；方块中心就是地点。
 * 方块里放彩色类型图标（Fluent Emoji，见 markerIcons），识别色放在右上角的字母小圆牌上；
 * 默认的「地点」不画图标，直接用识别色写字母代号——和侧栏卡片的徽标是同一条规则（markerShowsCode）。
 *
 * 颜色、图标、代号都编进图片 id，地图第一次用到某个 id 时由 styleimagemissing 现画，
 * 不必把所有颜色 × 图标 × 代号的组合预先注册一遍。彩色图标要先解码，没解码完时先画不带图标的方块，
 * 由 MapView 在 loadMarkerIconImages() 完成后统一重画。
 */

const ID_PREFIX = 'origin-marker'

// 以下尺寸都是 CSS 像素；画布按 pixelRatio 放大绘制，再以同一 pixelRatio 交给 Mapbox。
const SIZE = 30 // 方块边长
const RADIUS = 9 // 圆角半径
const ICON_SIZE = 20 // 方块里彩色图标的边长
const CHIP_RADIUS = 7.5 // 右上角字母圆牌半径
const CHIP_OFFSET = 13 // 圆牌圆心相对方块中心向右、向上的偏移：骑在右上角
const HALF = 24 // 图片半边长：方块居中（图片中心就是坐标点），四周留给投影和圆牌

const SHADOW_RGB = '15, 35, 70'
const CODE_FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif'

/** 拖拽和点击命中区半径：圆角方块最远的角离中心约 17.5px，再放宽一点，手指也好按住 */
export const ORIGIN_MARKER_HIT_RADIUS = 20

export type OriginMarkerSpec = { color: string; icon: MarkerIcon; code: string }

export function originMarkerImageId(color: string, icon: MarkerIcon | undefined, code: string): string {
  return [ID_PREFIX, color, resolveMarkerIcon(icon), code].join(':')
}

/** 不是本模块生成的 id（例如底图自带的 POI 图标）返回 null，留给 Mapbox 自己处理 */
export function parseOriginMarkerImageId(id: string): OriginMarkerSpec | null {
  const parts = id.split(':')
  if (parts.length !== 4 || parts[0] !== ID_PREFIX) return null
  const [, color, icon, code] = parts
  if (!color || !code) return null
  return { color, icon: resolveMarkerIcon(icon as MarkerIcon), code }
}

/** 按字形实际的上下边界居中，比 textBaseline = 'middle' 准（大写字母和数字没有下伸部） */
function fillCode(context: CanvasRenderingContext2D, code: string, x: number, y: number, size: number, color: string): void {
  context.font = `700 ${size}px ${CODE_FONT}`
  context.fillStyle = color
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  const metrics = context.measureText(code)
  context.fillText(code, x, y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2)
}

/**
 * 用同一形状填两次，各带一层投影：贴身的一层勾出边缘，散开的一层把方块从底图上托起来。
 * canvas 的阴影参数不跟随 scale 变换，按像素比手动放大。
 */
function fillWithShadows(context: CanvasRenderingContext2D, path: Path2D, color: string, pixelRatio: number): void {
  const layers = [
    { blur: 1.5, offsetY: 1, alpha: 0.32 },
    { blur: 8, offsetY: 3, alpha: 0.22 },
  ]
  for (const layer of layers) {
    context.save()
    context.shadowColor = `rgba(${SHADOW_RGB}, ${layer.alpha})`
    context.shadowBlur = layer.blur * pixelRatio
    context.shadowOffsetY = layer.offsetY * pixelRatio
    context.fillStyle = color
    context.fill(path)
    context.restore()
  }
}

/**
 * 把一个出发地标记画成 Mapbox addImage 可接收的 ImageData。
 * 调用方用同一个 pixelRatio 注册，地图上的逻辑尺寸就是 48 × 48 px，方块本身 30 × 30。
 */
export function createOriginMarkerImage(spec: OriginMarkerSpec, pixelRatio = 2): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.round(HALF * 2 * pixelRatio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建地图标记图像')
  context.scale(pixelRatio, pixelRatio)

  const center = HALF
  const square = new Path2D()
  square.roundRect(center - SIZE / 2, center - SIZE / 2, SIZE, SIZE, RADIUS)
  fillWithShadows(context, square, '#ffffff', pixelRatio)

  if (markerShowsCode(spec.icon)) {
    fillCode(context, spec.code, center, center, spec.code.length > 1 ? 13 : 16, spec.color)
    return context.getImageData(0, 0, canvas.width, canvas.height)
  }

  const icon = markerIconImage(spec.icon)
  if (icon) context.drawImage(icon, center - ICON_SIZE / 2, center - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE)

  // 右上角字母圆牌：识别色实心、白字，这是标记上唯一的识别色；两位数代号自动拉成胶囊形
  const chipX = center + CHIP_OFFSET
  const chipY = center - CHIP_OFFSET
  context.font = `700 11px ${CODE_FONT}`
  const chipWidth = Math.max(CHIP_RADIUS * 2, context.measureText(spec.code).width + 8)
  const chip = new Path2D()
  chip.roundRect(chipX - chipWidth / 2, chipY - CHIP_RADIUS, chipWidth, CHIP_RADIUS * 2, CHIP_RADIUS)
  context.save()
  context.shadowColor = `rgba(${SHADOW_RGB}, 0.3)`
  context.shadowBlur = 2 * pixelRatio
  context.shadowOffsetY = 1 * pixelRatio
  context.fillStyle = spec.color
  context.fill(chip)
  context.restore()
  fillCode(context, spec.code, chipX, chipY, 11, contrastText(spec.color))

  return context.getImageData(0, 0, canvas.width, canvas.height)
}
