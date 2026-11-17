// 深圳地铁官网线路配色（2026-11-06 核对 .lineN .xl_name_c）。
// https://www.szmc.net/map/
// https://www.szmc.net/styles/index/css/all.css
// 2/8 贯通线路同色，6B 为 6 号线支线。
const SHENZHEN_LINE_COLORS: Record<string, string> = {
  '1': '#0a9b4b', '2': '#905025', '2/8': '#905025', '3': '#0087d2',
  '4': '#be0f19', '5': '#824b82', '6': '#02c8b9', '6B': '#219089',
  '7': '#0a3282', '8': '#905025', '9': '#82646e', '10': '#f97c9c',
  '11': '#641937', '12': '#a794b0', '13': '#da830a', '14': '#e8cc60',
  '16': '#493d93', '20': '#83c8c3',
}
export const METRO_NEUTRAL_COLOR = '#475569'

export function metroLineColor(line: string, city = 'shenzhen'): string {
  return city === 'shenzhen' ? SHENZHEN_LINE_COLORS[line] ?? METRO_NEUTRAL_COLOR : METRO_NEUTRAL_COLOR
}

export function metroLineLabel(line: string): string {
  return line === '6B' ? '6号线支线' : `${line}号线`
}

/** 高德线路名可能含方向；只对已确认属于深圳的地铁段应用深圳色，避免混淆其他城市。 */
export function shenzhenRouteLineColor(mode: string, names: string[], city?: string): string | undefined {
  if (!['SUBWAY', 'METRO_RAIL'].includes(mode) || !city || !/^(深圳市?|shenzhen|440300)$/i.test(city.trim())) return undefined
  const name = names[0] ?? ''
  if (/6号线支线|6号支线|6B/i.test(name)) return SHENZHEN_LINE_COLORS['6B']
  const match = name.match(/(?:地铁\s*)?(\d+(?:\/\d+)?)号线/)
  return match ? SHENZHEN_LINE_COLORS[match[1]] : undefined
}
