import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import type { PolyFeature } from './geometry/ops'

export type ExportItem = {
  minutes?: number
  minutesByOrigin?: Record<string, number>
  feature: PolyFeature
}

export function buildExportCollection(
  items: ExportItem[],
): FeatureCollection<Polygon | MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: items.map((it) => ({
      ...it.feature,
      properties: {
        ...it.feature.properties,
        ...(it.minutes === undefined ? {} : { minutes: it.minutes }),
        ...(it.minutesByOrigin ? { minutesByOrigin: it.minutesByOrigin } : {}),
        crs: 'WGS-84',
      },
    })),
  }
}

export function downloadGeoJSON(items: ExportItem[], filename = 'isochrone-result.geojson'): void {
  const blob = new Blob([JSON.stringify(buildExportCollection(items), null, 2)], {
    type: 'application/geo+json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
