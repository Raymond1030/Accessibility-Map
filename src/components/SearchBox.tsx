import { useState } from 'react'
import { loadAmap } from '../amap/loader'
import { useStore } from '../state/store'

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
      const AMapNS = await loadAmap()
      const ps = new (AMapNS as any).PlaceSearch({ pageSize: 1 })
      const poi = await new Promise<any>((resolve, reject) => {
        ps.search(q, (status: string, result: any) => {
          if (status === 'complete' && result.poiList?.pois?.length) {
            resolve(result.poiList.pois[0])
          } else {
            reject(new Error('没有找到这个地点'))
          }
        })
      })
      addOrigin([poi.location.lng, poi.location.lat], poi.name)
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
        placeholder="搜地点加点，如「西二旗地铁站」"
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
