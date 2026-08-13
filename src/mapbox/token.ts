export class MapboxTokenMissingError extends Error {
  constructor() {
    super('未配置 Mapbox token。请在 .env 填入 VITE_MAPBOX_TOKEN。')
    this.name = 'MapboxTokenMissingError'
  }
}

export function getMapboxToken(): string {
  const t = import.meta.env.VITE_MAPBOX_TOKEN
  if (!t) throw new MapboxTokenMissingError()
  return t
}
