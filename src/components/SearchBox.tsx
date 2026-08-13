import { useState } from 'react'
import { searchPlace } from '../amap/search'
import { useStore } from '../state/store'

/**
 * 搜索走高德（结果转 WGS-84），等时圈与底图走 Mapbox。
 * 实测 Mapbox Geocoding 在国内连「深圳北站」都只匹配到「深圳市」，
 * 两个不同的搜索会落在同一个市中心点——搜索必须借高德。
 */
export function SearchBox() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const addOrigin = useStore((s) => s.addOrigin)

  async function search() {
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const hit = await searchPlace(q.trim())
      addOrigin(hit.lngLat, hit.name)
      setQ('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="search-box">
      <input
        value={q}
        placeholder="搜地点加点，如「深圳湾公园」"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
      />
      <button onClick={() => void search()} disabled={busy}>
        {busy ? '搜索中' : '添加'}
      </button>
      {err && <p className="hint error">{err}</p>}
    </div>
  )
}
