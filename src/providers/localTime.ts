/** UI values are always displayed as UTC+08:00, independent of the browser timezone. */
export function localQueryNow(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16)
}

export function localQueryDateTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请选择有效的公交日期和时刻。')
  return `${value}:00+08:00`
}
