import { useState } from 'react'
import { useExplore } from '../explore/store'
import { CATEGORIES } from '../explore/types'
import { useStore } from '../state/store'
import { locateCurrentPosition } from '../geo/locate'
import { PlacePicker } from './PlacePicker'
import { PoiCard, ProfileResults, SelectedRoute, TravelSettings, WeightPicker } from './LifeProfile'
import './Life.css'

export function ExplorePanel() {
  const s = useExplore(); const drawerOpen = useStore(s => s.drawerOpen)
  const [locating, setLocating] = useState(false); const [locateError, setLocateError] = useState('')
  const settings = s.view === 'profile' ? s.profileSettings : s.blindSettings
  const showMap = () => useStore.getState().setDrawerOpen(false)
  const select = (p: Parameters<typeof s.select>[0]) => { s.select(p); showMap() }
  async function locate() {
    setLocating(true); setLocateError('')
    try { const r = await locateCurrentPosition(); s.setCenter({ name: '我的位置', lngLat: r.lngLat }) }
    catch (e) { setLocateError(e instanceof Error ? e.message : String(e)) }
    finally { setLocating(false) }
  }
  return <aside className={`sidebar commute-panel explore-panel${drawerOpen ? '' : ' collapsed'}`}>
    <button className="drawer-handle" onClick={() => useStore.getState().toggleDrawer()} aria-expanded={drawerOpen}><span className="grip" /><span className="summary">{s.view === 'profile' ? '生活画像' : '周末城市盲盒'}{s.center && ` · ${s.center.name}`}</span><span className="caret">{drawerOpen ? '⌄' : '⌃'}</span></button>
    <div className="commute-scroll"><header className="commute-intro"><span className="eyebrow">THE EVERYDAY ATLAS / 生活探索</span><h1>把附近，过成喜欢。</h1><p>找日常所需，也找一点周末的新鲜感。</p></header>
      <div className="commute-view-tabs">{(['profile', 'blindbox'] as const).map(v => <button key={v} aria-pressed={s.view === v} onClick={() => s.setView(v)}>{v === 'profile' ? '生活画像' : '周末盲盒'}</button>)}</div>
      <section className="commute-section"><h2><span>01</span> 从哪里出发</h2><label className="life-field">探索城市<input value={s.city} onChange={e => s.setCity(e.target.value)} /></label>
        <PlacePicker key={s.city} city={s.city} label="搜索住处或出发地点" onSelect={s.setCenter} />
        <div className="life-inline-actions"><button className="commute-text-button" onClick={() => { useExplore.setState({ picking: !s.picking }); if (!s.picking) showMap() }}>{s.picking ? '取消选点' : '＋ 地图选点'}</button><button className="commute-text-button" disabled={locating} onClick={() => void locate()}>{locating ? '定位中…' : '◎ 当前位置'}</button></div>
        {locateError && <p className="commute-error">{locateError}</p>}{s.center && <div className="workplace"><span>起</span><strong>{s.center.name}</strong></div>}
      </section>
      <section className="commute-section"><h2><span>02</span> 想走多远</h2><TravelSettings {...settings} onChange={(mode, minutes) => s.setSettings({ mode, minutes })} />
        {settings.mode === 'transit' && <p className="commute-note">公交／地铁从所选城市周边 50 公里内的候选逐点核验耗时；地图不绘制公交等时圈。</p>}
        {s.view === 'profile' ? <WeightPicker weights={s.weights} onChange={s.setWeight} /> : <div className="life-interests">{CATEGORIES.map(c => <button key={c.id} aria-pressed={s.interests.includes(c.id)} onClick={() => s.toggleInterest(c.id)}>{c.label}</button>)}</div>}
        <button className="commute-primary" disabled={!s.center || !s.city.trim() || s.busy} onClick={() => void s.evaluate()}>{s.busy ? '正在检索地点并核验路线…' : s.view === 'profile' ? '生成生活画像' : s.draw ? '换一批' : '抽取三个去处'}</button>
        {s.error && <p className="commute-error" role="alert">{s.error}</p>}
      </section>
      <section className="commute-section" aria-live="polite">{s.view === 'profile' ? <ProfileResults profile={s.profile} weights={s.weights} onSelect={select} /> : <>
        {!s.draw && !s.busy && <p className="commute-empty">给周末留一点惊喜。选择出发点，抽几个时间范围内能到的地方。</p>}
        {s.draw?.places.map(p => <PoiCard key={p.poi.id} place={p} onSelect={select} actions={<><button onClick={() => s.favorite(p)}>{s.favorites.some(f => f.poi.id === p.poi.id) ? '取消收藏' : '收藏'}</button><button onClick={() => s.reject(p.poi.id)}>不感兴趣</button></>} />)}
        {s.draw && s.draw.places.length < 3 && <p className="commute-note">本次找到 {s.draw.places.length} 个符合条件的去处。{s.draw.exhausted ? '本次候选已用完，可调整条件或重置抽取记录。' : '可换一批继续尝试。'}</p>}
        {!!s.draw?.errors.length && <p className="commute-error">部分查询未完成：{s.draw.errors[0]}。点击“换一批”重试。</p>}
        <div className="life-inline-actions"><button className="commute-text-button" disabled={s.busy} onClick={s.resetDraw}>重置当前条件的抽取记录</button>{!!s.rejected.length && <button className="commute-text-button" onClick={() => useExplore.setState({ rejected: [] })}>恢复不感兴趣地点</button>}</div>
        {!!s.favorites.length && <details><summary>本次收藏 · {s.favorites.length}</summary><p className="commute-note">收藏中的耗时来自收藏时的出发点和查询条件。</p>{s.favorites.map(p => <PoiCard key={p.poi.id} place={p} onSelect={select} actions={<button onClick={() => s.favorite(p)}>取消收藏</button>} />)}</details>}
      </>}</section>
      <SelectedRoute place={s.selected} onShowMap={showMap} />
      <p className="commute-note commute-footer">只统计本次查询的地点样本。耗时为查询时估算，营业状态请出发前确认。输入、收藏与抽取记录仅保留在当前页面，刷新后清空。</p>
    </div>
  </aside>
}
