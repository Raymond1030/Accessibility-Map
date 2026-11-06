import type { PolyFeature } from '../geometry/ops'

export const RANGE_MODES = ['subway-walking', 'driving', 'cycling', 'walking'] as const
export type RangeMode = typeof RANGE_MODES[number]
export const RANGE_LABELS: Record<RangeMode, string> = {
  'subway-walking': '地铁', driving: '驾车', cycling: '骑行', walking: '步行',
}
export const RANGE_COLORS: Record<RangeMode, string> = {
  'subway-walking': '#7c3aed', driving: '#2563a6', cycling: '#147d67', walking: '#b45309',
}
export type RangeResult =
  | { status: 'idle' | 'empty' }
  | { status: 'loading'; message?: string }
  | { status: 'ok'; geometry: PolyFeature }
  | { status: 'error'; message: string }
