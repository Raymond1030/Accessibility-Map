export type Mode = 'driving' | 'driving-traffic' | 'walking' | 'cycling'

export const MODE_LABEL: Record<Mode, string> = {
  driving: '驾车',
  'driving-traffic': '驾车（实时路况）',
  walking: '步行',
  cycling: '骑行',
}

export type Origin = {
  id: string
  label: string
  lngLat: [number, number]
  mode: Mode
  thresholds: number[]
  color: string
  visible: boolean
}

/** 同档配对：档位全局共享；自定义：每点独立选一个档位 */
export type BandMode = 'paired' | 'custom'

export type SetOp = 'intersect' | 'union' | 'difference'

export const MAX_MINUTES = 60

export type CellKey = string

/** 一个起点在一个档位上的数据格，是请求与缓存的最小单位 */
export function cellKey(originId: string, minutes: number): CellKey {
  return `${originId}@${minutes}`
}
