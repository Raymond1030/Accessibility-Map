/**
 * 地图视觉编码的唯一来源：侧栏图例、点标记和 Mapbox 图层都从这里取值，
 * 避免界面上展示的透明度和地图实际画出来的不一致。
 */
export const ORIGIN_PALETTE = [
  '#1769D2', // blue
  '#DE4D2A', // vermilion
  '#008B72', // teal
  '#B83B91', // magenta
  '#B87500', // amber
] as const

export const RESULT_COLOR = '#5138C9'

function bandPosition(thresholds: number[], minutes: number): number {
  const ordered = [...new Set(thresholds)].sort((a, b) => a - b)
  if (ordered.length <= 1) return 0.38
  const index = Math.max(0, ordered.indexOf(minutes))
  return index / (ordered.length - 1)
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 近距离范围更浓、远距离范围更淡；单档保持中等浓度。 */
export function originBandOpacity(thresholds: number[], minutes: number): number {
  const position = bandPosition(thresholds, minutes)
  return rounded(0.27 - position * 0.16)
}

export function originBandLineOpacity(thresholds: number[], minutes: number): number {
  const position = bandPosition(thresholds, minutes)
  return rounded(0.96 - position * 0.24)
}

export function originBandLineWidth(thresholds: number[], minutes: number): number {
  const position = bandPosition(thresholds, minutes)
  return rounded(2.6 - position * 1.1)
}

/** 合成结果使用同样的时间深浅语法，但轮廓比单点范围更强。 */
export function resultBandOpacity(thresholds: number[], minutes: number): number {
  const position = bandPosition(thresholds, minutes)
  return rounded(0.24 - position * 0.14)
}

export function resultBandLineWidth(thresholds: number[], minutes: number): number {
  const position = bandPosition(thresholds, minutes)
  return rounded(3.6 - position * 1.2)
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (!/^[\da-f]{6}$/i.test(normalized)) return `rgba(23, 35, 59, ${alpha})`
  const value = Number.parseInt(normalized, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function contrastText(hex: string): '#ffffff' | '#17233b' {
  const normalized = hex.replace('#', '')
  if (!/^[\da-f]{6}$/i.test(normalized)) return '#ffffff'
  const value = Number.parseInt(normalized, 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  const luminance = channels
    .map((channel) => {
      const srgb = channel / 255
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  // 不是用一个拍脑袋的亮度阈值，而是比较两种候选字色的真实对比度。
  const inkLuminance = 0.0168
  const whiteContrast = 1.05 / (luminance + 0.05)
  const inkContrast = (luminance + 0.05) / (inkLuminance + 0.05)
  return inkContrast > whiteContrast ? '#17233b' : '#ffffff'
}

export function originCode(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
}
