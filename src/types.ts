export type Mode = 'transit' | 'driving' | 'walking' | 'cycling'

export type TransitPolicy = 'ALL' | 'SUBWAY' | 'BUS'

export type Origin = {
  id: string
  label: string
  lngLat: [number, number]
  mode: Mode
  policy: TransitPolicy
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
