/**
 * 地图视觉编码的唯一来源：侧栏图例、点标记和 Mapbox 图层都从这里取值，
 * 避免界面上展示的透明度和地图实际画出来的不一致。
 */
// 底图使用 Mapbox Streets 原色（绿地、黄色干道），所以范围色避开绿色和黄色，以免与绿地、道路混在一起；
// 紫色留给多点运算结果（RESULT_COLOR）。按添加顺序取色：最常见的 2–3 人场景里，相邻颜色色差最大。
export const ORIGIN_PALETTE = [
  '#1769D2', // blue
  '#DE4D2A', // vermilion
  '#B83B91', // magenta
  '#8E5B3A', // umber
  '#006F84', // deep cyan
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

/**
 * 可达范围的边界画成虚线，与首页案例卡片一致：等时圈本来就是近似的边界，
 * 虚线也和实线的道路、路线区分得开。单位是线宽（Mapbox 按各自线宽缩放）：画 3、空 2。
 */
export const RANGE_DASH: [number, number] = [3, 2]

/** 合成结果轮廓的默认线宽（要素没带 lineWidth 时）；衬线宽度与衬线虚线都从同一个线宽推出 */
export const RESULT_LINE_WIDTH = 2.8

/** 合成结果轮廓下面的白色衬线，比轮廓本身宽这么多像素 */
export const RESULT_CASING_EXTRA = 3.4

/**
 * 彩色虚线下面那条白色衬线的虚线参数：每一段衬线正好垫在一段彩色虚线下面，空隙里露出底图。
 * 两层线宽不同，而虚线长度按各自线宽缩放，所以按宽度比例换算。
 * 不能取整：周期差一点点，沿着几百公里长的轮廓就会越错越开。
 * 两层的线宽要么都是常量、要么都按要素取值：Mapbox 对常量线宽的虚线另有缩放，混用会在缩放时错开。
 */
export function casingDash(lineWidth: number, casingWidth: number): [number, number] {
  const k = lineWidth / casingWidth
  return [RANGE_DASH[0] * k, RANGE_DASH[1] * k]
}

/** 合成结果轮廓的白色衬线（比轮廓宽 RESULT_CASING_EXTRA 像素）用的虚线参数 */
export function resultCasingDash(lineWidth: number): [number, number] {
  return casingDash(lineWidth, lineWidth + RESULT_CASING_EXTRA)
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
