import { useEffect, useRef, useState } from 'react'
import { searchPlaces, type SearchHit } from '../amap/search'
import type { Place } from '../commute/types'

export function PlacePicker({ label, city, onSelect, disabled = false }: { label: string; city: string; onSelect: (place: Place) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(''); const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const version = useRef(0)
  useEffect(() => () => { version.current++ }, [city])
  async function search() {
    if (!query.trim() || busy) return
    const run = ++version.current; setBusy(true); setHits([]); setError('')
    try { const found = await searchPlaces(query.trim(), city); if (run === version.current) setHits(found) }
    catch (e) { if (run === version.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (run === version.current) setBusy(false) }
  }
  return <div className="commute-search">
    <form onSubmit={e => { e.preventDefault(); void search() }}><input aria-label={label} placeholder={label} disabled={disabled} value={query}
      onChange={e => { version.current++; setQuery(e.target.value); setHits([]); setError(''); setBusy(false) }} /><button disabled={disabled || busy || !query.trim()}>{busy ? '搜索中…' : '搜索'}</button></form>
    {error && <p className="commute-error" role="alert">{error}</p>}
    {!!hits.length && <ul className="place-options">{hits.map((hit, i) => <li key={i}><button disabled={disabled} onClick={() => { onSelect(hit); setHits([]); setQuery('') }}><strong>{hit.name}</strong><small>{hit.address}</small></button></li>)}</ul>}
  </div>
}
