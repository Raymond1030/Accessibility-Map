import { useState } from 'react'
import { loadAmap } from '../amap/loader'
import { isConfigError, describeConfigError } from '../amap/errors'
import { useStore } from '../state/store'

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
      const AMapNS = await loadAmap()
      const ps = new (AMapNS as any).PlaceSearch({ pageSize: 1 })
      const poi = await new Promise<any>((resolve, reject) => {
        ps.search(q, (status: string, result: any) => {
          if (status === 'complete' && result.poiList?.pois?.length) {
            resolve(result.poiList.pois[0])
            return
          }
          // 失败时 result 可能是错误码字符串（如 INVALID_USER_DOMAIN），
          // 一律报「没有找到这个地点」会把配置问题伪装成搜索无结果，
          // 让人对着正确的地名反复重试。
          const raw = typeof result === 'string' ? result : result?.info
          if (status === 'error' || (raw && raw !== 'OK')) {
            reject(new Error(`搜索失败：${raw ?? status}`))
          } else {
            reject(new Error('没有找到这个地点'))
          }
        })
      })
      addOrigin([poi.location.lng, poi.location.lat], poi.name)
      setQ('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 配置问题升到全局横幅——它影响的不只是搜索，整个应用都用不了
      if (isConfigError(msg)) setFatalError(describeConfigError(msg))
      setErr(msg)
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
