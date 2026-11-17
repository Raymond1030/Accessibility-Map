import type { FeatureCollection, LineString, Point } from 'geojson'
import type { Route, TransitLeg } from './types'

// 公交及未知城市/线路的备用配色；深圳地铁使用 transit/lineColors.ts。
export const TRANSIT_COLORS = ['#1769aa', '#b45309', '#7c3aed', '#0e766e', '#be185d']
export const WALK_COLOR = '#64748b'
export function transitModeLabel(mode: string): string {
  return ({ WALK: '步行', BUS: '公交', SUBWAY: '地铁', METRO_RAIL: '轨道交通', RAILWAY: '铁路', TAXI: '出租车' } as Record<string, string>)[mode] ?? '接驳'
}
export function legLabel(leg: TransitLeg): string {
  return leg.lines.length ? leg.lines.map(name => name.replace(/[（(].*$/, '').trim()).join(' / ') : transitModeLabel(leg.mode)
}

export function routeFeatures(route: Route | null): FeatureCollection<LineString> {
  const legs = route?.transitLegs
  // 有分段信息时，缺失的某段轨迹保持缺失；不使用整体线冒充该段。
  return { type: 'FeatureCollection', features: legs?.length
    ? legs.filter(leg => leg.path.length > 1).map(leg => ({
      type: 'Feature', properties: { color: leg.color, walking: leg.mode === 'WALK', label: legLabel(leg) },
      geometry: { type: 'LineString', coordinates: leg.path },
    }))
    : (route?.paths ?? []).map(coordinates => ({
      type: 'Feature', properties: { color: '#5138c9', walking: false, label: '' }, geometry: { type: 'LineString', coordinates },
    })) }
}

export function stationFeatures(route: Route | null): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: (route?.transitLegs ?? []).flatMap(leg => {
    if (leg.mode === 'WALK') return []
    return [
      { name: leg.from, location: leg.fromLocation }, { name: leg.to, location: leg.toLocation },
    ].flatMap(stop => stop.location && stop.name ? [{
      type: 'Feature' as const, properties: { name: stop.name, color: leg.color },
      geometry: { type: 'Point' as const, coordinates: stop.location },
    }] : [])
  }) }
}
