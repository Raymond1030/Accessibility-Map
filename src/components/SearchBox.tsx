import { useState } from 'react'
import { getMapboxToken } from '../mapbox/token'
import { useStore } from '../state/store'

type GeocodeFeature = {
  center: [number, number]
  text_zh?: string
  text?: string
  place_name_zh?: string
}

export function SearchBox() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const addOrigin = useStore((s) => s.addOrigin)
  const setFatalError = useStore((s) => s.setFatalError)

  async function search() {
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json?` +
        new URLSearchParams({
          access_token: getMapboxToken(),
          language: 'zh',
          country: 'cn',
          limit: '1',
        })
      const res = await fetch(url)
      if (res.status === 401 || res.status === 403) {
        // token 层面的失败影响整个应用，升为全局提示
        const msg = `Mapbox token 无效或权限不足（HTTP ${res.status}）`
        setFatalError(msg)
        throw new Error(msg)
      }
      if (!res.ok) throw new Error(`搜索失败（HTTP ${res.status}）`)

      const data = await res.json()
      const f: GeocodeFeature | undefined = data.features?.[0]
      if (!f) throw new Error('没有找到这个地点')

      addOrigin(f.center, f.text_zh ?? f.text ?? q.trim())
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
