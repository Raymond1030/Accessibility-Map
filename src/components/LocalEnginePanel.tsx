import { useEffect, useState } from 'react'
import { getLocalEngineUrl } from '../providers/local'
import './LocalEnginePanel.css'

type EngineHealth = {
  status: string; label: string; dataVersion: string
  transit: Array<{ id: string; routes: number; limitations: string[] }>
}

export function LocalEngineStatus() {
  const url = getLocalEngineUrl()
  const [health, setHealth] = useState<EngineHealth | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setHealth(null)
    setError('')
    fetch(`${url}/health`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!body.status || !body.dataVersion || !Array.isArray(body.transit)) throw new Error('状态响应无效')
        setHealth(body)
      })
      .catch(() => { if (!controller.signal.aborted) setError('本地引擎未连接，请先启动引擎。') })
    return () => controller.abort()
  }, [url, revision])
  if (!url) return null
  return <details className="local-engine-status"><summary>{error ? '地图服务暂不可用' : '地图服务设置'}</summary>
    <div><strong>本地计算 · {health?.label ?? '连接检查'}</strong><button type="button" onClick={() => setRevision(value => value + 1)}>刷新状态</button></div>
    <p>{error || (health ? health.status === 'ready' ? 'GraphHopper 已就绪 · OSM 路网' : '引擎正在建图或尚未就绪' : '正在连接本机服务…')}</p>
    {health && <>
      <p>{health.transit.length ? `已导入 ${health.transit.reduce((sum, feed) => sum + feed.routes, 0)} 条 GTFS 路线记录。` : '当前区域未导入公交 GTFS。'}</p>
      {health.transit.flatMap(feed => feed.limitations).map((note, index) => <small key={`${index}-${note}`}>{note}</small>)}
      <small>图版本 {health.dataVersion.slice(0, 10)} · © OpenStreetMap contributors</small>
    </>}
  </details>
}

export function LocalQueryInputs({ direction, onDirectionChange, dateTime, onDateTimeChange }: {
  direction: 'depart' | 'arrive'
  onDirectionChange: (value: 'depart' | 'arrive') => void
  dateTime?: string
  onDateTimeChange?: (value: string) => void
}) {
  return <div className="local-query-inputs">
    <label>出行方向<select value={direction} onChange={event => onDirectionChange(event.target.value as 'depart' | 'arrive')}>
      <option value="depart">从地点出发</option><option value="arrive">到达地点</option>
    </select></label>
    {onDateTimeChange && <label>{direction === 'arrive' ? '到达' : '出发'}时刻（UTC+08:00）
      <input type="datetime-local" value={dateTime} step="60" onChange={event => onDateTimeChange(event.target.value)} />
    </label>}
  </div>
}
