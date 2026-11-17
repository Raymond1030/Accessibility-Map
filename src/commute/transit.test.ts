import { expect, it } from 'vitest'
import { legLabel, routeFeatures, stationFeatures } from './transit'
import type { Route, TransitLeg } from './types'
const leg: TransitLeg = { mode: 'SUBWAY', lines: ['1号线(罗湖--机场东)'], color: '#1769aa', path: [[114, 22], [114.01, 22.01]], from: '深大', fromLocation: [114, 22], to: '桃园' }
const route: Route = { seconds: 60, meters: 500, paths: [leg.path], instructions: [], fetchedAt: 1,
  transitLegs: [leg, { ...leg, mode: 'WALK', lines: [], color: '#64748b' }, { ...leg, lines: ['M109路'], path: [] }] }
it('分段颜色、步行虚线和线路标签使用相同数据，缺轨迹不画假线', () => {
  const features = routeFeatures(route).features
  expect(features).toHaveLength(2)
  expect(features[0].properties).toEqual({ color: '#1769aa', walking: false, label: '1号线' })
  expect(features[1].properties?.walking).toBe(true)
  expect(routeFeatures(null).features).toEqual([])
})
it('只绘制有真实坐标的乘车站点，缺失站点不借用路径端点', () => {
  const features = stationFeatures({ ...route, transitLegs: [leg] }).features
  expect(features).toHaveLength(1)
  expect(features[0].properties?.name).toBe('深大')
  expect(stationFeatures({ ...route, transitLegs: [{ ...leg, mode: 'WALK' }] }).features).toEqual([])
})
it('普通路线保留轨迹，同段备选线路用斜线连接而非换乘箭头', () => {
  expect(routeFeatures({ ...route, transitLegs: undefined }).features[0].geometry.coordinates).toEqual(leg.path)
  expect(legLabel({ ...leg, lines: ['M109路（南山方向）', '72路'] })).toBe('M109路 / 72路')
})
