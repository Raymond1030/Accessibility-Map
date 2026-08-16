import type { MarkerIcon } from '../types'

type MarkerIconOption = {
  id: MarkerIcon
  label: string
}

export const MARKER_ICON_OPTIONS: readonly MarkerIconOption[] = [
  { id: 'place', label: '地点' },
  { id: 'home', label: '住宅' },
  { id: 'work', label: '工作' },
  { id: 'school', label: '学校' },
  { id: 'transit', label: '交通' },
  { id: 'food', label: '餐饮' },
  { id: 'medical', label: '医疗' },
  { id: 'star', label: '收藏' },
] as const

const MARKER_ICON_IDS = new Set<MarkerIcon>(MARKER_ICON_OPTIONS.map((option) => option.id))

/** 旧数据可能没有 markerIcon；遇到未知值也安全回退到通用地点图标。 */
export function resolveMarkerIcon(icon: MarkerIcon | undefined): MarkerIcon {
  return icon && MARKER_ICON_IDS.has(icon) ? icon : 'place'
}

type IconShape =
  | { type: 'path'; d: string }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number; rx: number }

const ICON_SHAPES: Record<MarkerIcon, readonly IconShape[]> = {
  place: [
    { type: 'circle', cx: 12, cy: 11, r: 3.4 },
    { type: 'path', d: 'M5.8 11a6.2 6.2 0 0 1 12.4 0c0 4.5-6.2 9.2-6.2 9.2S5.8 15.5 5.8 11Z' },
  ],
  home: [
    { type: 'path', d: 'm3.8 11.2 8.2-7 8.2 7' },
    { type: 'path', d: 'M6.4 9.5v10h11.2v-10M10 19.5v-6h4v6' },
  ],
  work: [
    { type: 'rect', x: 3.5, y: 7.2, width: 17, height: 12.2, rx: 2 },
    { type: 'path', d: 'M9 7.2V4.8h6v2.4M3.5 12h17M9.5 12v2h5v-2' },
  ],
  school: [
    { type: 'path', d: 'm3 9 9-4.7L21 9l-9 4.7L3 9Z' },
    { type: 'path', d: 'M6.5 11v5.2c3.2 2.3 7.8 2.3 11 0V11M21 9v6' },
  ],
  transit: [
    { type: 'rect', x: 5, y: 3.5, width: 14, height: 15, rx: 3 },
    { type: 'path', d: 'M5 9h14M8 13h.1m7.9 0h.1M8 18.5 6.5 21m9.5-2.5 1.5 2.5' },
  ],
  food: [
    { type: 'path', d: 'M7 3.5v6M4.5 3.5v4c0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5v-4M7 10v10.5M15.5 3.5v17M15.5 3.5c3 1.6 4.4 5.4 2.8 8.5h-2.8' },
  ],
  medical: [
    { type: 'path', d: 'M9 3.5h6v5.3h5.5v6H15v5.7H9v-5.7H3.5v-6H9V3.5Z' },
  ],
  star: [
    { type: 'path', d: 'm12 3.2 2.7 5.5 6 .9-4.4 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.4-4.2 6-.9L12 3.2Z' },
  ],
}

function shapeMarkup(shape: IconShape): string {
  if (shape.type === 'circle') {
    return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"/>`
  }
  if (shape.type === 'rect') {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx}"/>`
  }
  return `<path d="${shape.d}"/>`
}

export function markerIconMarkup(icon: MarkerIcon | undefined): string {
  return ICON_SHAPES[resolveMarkerIcon(icon)].map(shapeMarkup).join('')
}

export function markerIconImageId(icon: MarkerIcon | undefined): string {
  return `origin-symbol-${resolveMarkerIcon(icon)}`
}

/**
 * 把同一套预设矢量路径绘制成 Mapbox addImage 可接收的 ImageData。
 * pixelRatio=2 保持高 DPI 清晰度，地图上的逻辑尺寸仍为 24px。
 */
export function createMarkerIconImage(icon: MarkerIcon | undefined, pixelRatio = 2): ImageData {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size * pixelRatio
  canvas.height = size * pixelRatio
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建地图标记图像')

  context.scale(pixelRatio, pixelRatio)
  context.strokeStyle = '#ffffff'
  context.lineWidth = 1.8
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (const shape of ICON_SHAPES[resolveMarkerIcon(icon)]) {
    if (shape.type === 'path') {
      context.stroke(new Path2D(shape.d))
      continue
    }

    context.beginPath()
    if (shape.type === 'circle') {
      context.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2)
    } else {
      context.roundRect(shape.x, shape.y, shape.width, shape.height, shape.rx)
    }
    context.stroke()
  }

  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export function MarkerIconGlyph({
  icon,
  className,
}: {
  icon: MarkerIcon | undefined
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: markerIconMarkup(icon) }}
    />
  )
}
