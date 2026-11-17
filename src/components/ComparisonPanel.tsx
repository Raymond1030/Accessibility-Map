import { useState } from 'react'
import { COMMUTE_LABELS, COMMUTE_MODES, type Home, type Place, type Route } from '../commute/types'
import { useCommute } from '../commute/store'
import { effectiveVisits, selectedPair, useComparison } from '../commute/comparisonStore'
import { rentComparison, weeklyTotal } from '../commute/comparison'
import { categoryLabel, enabledCategories, type ReachablePoi } from '../explore/types'
import { profileScore } from '../explore/profile'
import { useStore } from '../state/store'
import { PlacePicker } from './PlacePicker'
import { ProfileResults, TravelSettings, WeightPicker } from './LifeProfile'
import { TransitItinerary } from './TransitItinerary'
import './Life.css'

const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} 小时`
export function ComparisonPanel({ moving = false }: { moving?: boolean }) {
  const c = useCommute(); const s = useComparison(); const { base, target } = selectedPair()
  const visits = effectiveVisits(); const [visitCity, setVisitCity] = useState(c.city)
  const inspect = (origin: Place, destination: Place, route: Route) => {
    useComparison.setState({ inspection: { origin, destination, route } }); useStore.getState().setDrawerOpen(false)
  }
  const inspectPoi = (home: Home, p: ReachablePoi) => inspect(home, p.poi, p.route)
  const rent = base && target ? rentComparison(base.rent, target.rent, s.trips[base.id]?.work, s.trips[target.id]?.work, s.days) : null
  const before = base ? weeklyTotal(visits, s.trips[base.id] ?? {}) : null
  const after = target ? weeklyTotal(visits, s.trips[target.id] ?? {}) : null
  return <section className="commute-section comparison-panel">
    <h2>{moving ? '搬过去，一周会怎样' : '租金买时间'}</h2>
    {c.homes.length < 2 ? <p className="commute-empty">请先在“比较住处”添加至少两个住处，就能对比租金、时间和附近生活。</p> : <>
      <div className="commute-fields"><label>比较基准<select value={base?.id ?? ''} onChange={e => s.setPair(e.target.value, target?.id ?? null)}>{c.homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label><label>候选住处<select value={target?.id ?? ''} onChange={e => s.setPair(base?.id ?? null, e.target.value)}>{c.homes.filter(h => h.id !== base?.id).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label></div>
      <div className="commute-fields"><label>每月通勤天数<input aria-label="每月通勤天数" type="number" min="1" max="31" value={s.days} onChange={e => s.setDays(Number(e.target.value))} /></label><label>通勤方式<select value={c.mode} onChange={e => useCommute.setState({ mode: e.target.value as typeof c.mode })}>{COMMUTE_MODES.map(m => <option key={m} value={m}>{COMMUTE_LABELS[m]}</option>)}</select></label></div>
      {moving && <>
        <h3>一周常去的地方</h3>
        {c.workplace && <div className="life-visit"><strong>{c.workplace.name} · 公司</strong><label>每周往返次数<input aria-label="公司每周往返次数" type="number" min="0" max="21" value={s.workWeekly} onChange={e => s.setWorkWeekly(Number(e.target.value))} /></label></div>}
        {s.visits.map(v => <div className="life-visit" key={v.id}><div className="life-inline-actions"><strong>{v.place.name}</strong><button onClick={() => s.setVisits(s.visits.filter(x => x.id !== v.id))} aria-label={`删除常去地点${v.place.name}`}>移除</button></div><div className="commute-fields"><label>地点城市<input value={v.city} onChange={e => s.setVisits(s.visits.map(x => x.id === v.id ? { ...x, city: e.target.value } : x))} /></label><label>每周往返次数<input type="number" min="0" max="21" value={v.weekly} onChange={e => s.setVisits(s.visits.map(x => x.id === v.id ? { ...x, weekly: Math.max(0, Math.min(21, Math.round(Number(e.target.value)) || 0)) } : x))} /></label></div><select aria-label={`${v.place.name}出行方式`} value={v.mode} onChange={e => s.setVisits(s.visits.map(x => x.id === v.id ? { ...x, mode: e.target.value as typeof v.mode } : x))}>{COMMUTE_MODES.map(m => <option key={m} value={m}>{COMMUTE_LABELS[m]}</option>)}</select></div>)}
        {s.visits.length < 5 && <><label className="life-field">新增常去地点的城市<input value={visitCity} onChange={e => setVisitCity(e.target.value)} /></label><PlacePicker key={visitCity} label="添加亲友家、健身房等" city={visitCity} disabled={!visitCity.trim()} onSelect={place => s.setVisits([...s.visits, { id: crypto.randomUUID(), place, city: visitCity.trim(), mode: c.mode, weekly: 1 }])} /></>}
        <p className="commute-note">最多添加 5 个常去地点。“1 次”按完整往返计算，可选填。</p>
        <h3>两处住处，共用一组生活偏好</h3><TravelSettings mode={s.profileMode} minutes={s.profileMinutes} onChange={s.setProfileSettings} /><WeightPicker weights={s.weights} onChange={(id, weight) => s.setWeights({ ...s.weights, [id]: weight })} />
      </>}
      <button className="commute-primary" disabled={s.busy || !c.city.trim() || (c.workplace !== null && !c.destinationCity.trim()) || (!moving && !c.workplace) || (moving && s.visits.some(v => !v.city.trim()))} onClick={() => void s.evaluate(moving)}>{s.busy ? '正在比较通勤与附近生活…' : moving ? '比较搬家后的生活' : '比较通勤与租金'}</button>
      {!c.workplace && <p className="commute-note">添加公司后可计算租金与通勤时间的关系。</p>}
      {s.error && <p className="commute-error" role="alert">{s.error}</p>}
      {base && target && <div className="life-comparison-results" aria-live="polite">
        <div className="life-pair"><div><small>比较基准</small><strong>{base.name}</strong><span>{base.rent === null ? '月租待填写' : `¥${base.rent.toLocaleString()} / 月`}</span></div><div><small>候选住处</small><strong>{target.name}</strong><span>{target.rent === null ? '月租待填写' : `¥${target.rent.toLocaleString()} / 月`}</span></div></div>
        <div className="life-rent-result"><strong>{rent?.verdict}</strong><p>{rent?.delta == null ? '待填写两处月租' : `每月租金${rent.delta > 0 ? '多' : rent.delta < 0 ? '少' : '差额'} ¥${Math.abs(rent.delta).toFixed(0)}`}</p><p>{rent?.hours == null ? '通勤时间暂未找到' : `每月${rent.hours >= 0 ? '省下' : '多花'} ${Math.abs(rent.hours).toFixed(1)} 小时`}</p>{rent?.price != null && <p className="life-price">每省下 1 小时，多付 <b>¥{rent.price.toFixed(1)}</b></p>}</div>
        {moving && before && after && <div className="life-weekly"><h3>一周出行时间</h3><div className="life-pair">{[before, after].map((r, i) => <div key={i}><small>{i ? target.name : base.name}</small><strong>{hours(r.seconds)}{!r.complete && '（已完成部分）'}</strong>{!r.complete && <p className="commute-error">缺少：{r.missing.join('、')}</p>}</div>)}</div>{before.complete && after.complete && <p>每周{before.seconds >= after.seconds ? '省下' : '多花'} {hours(Math.abs(before.seconds - after.seconds))}</p>}</div>}
        <div className="life-trips">{(moving ? visits : visits.filter(v => v.id === 'work')).map(v => <details key={v.id} open><summary>{v.place.name} · {COMMUTE_LABELS[v.mode]}</summary><div className="life-pair">{[base, target].map(h => { const trip = s.trips[h.id]?.[v.id]; return <div key={h.id}><small>{h.name}</small>{(['out', 'back'] as const).map(direction => { const route = trip?.[direction]; return <button className="commute-text-button" key={direction} disabled={!route} onClick={() => route && inspect(direction === 'out' ? h : v.place, direction === 'out' ? v.place : h, route)}>{direction === 'out' ? '去程' : '回程'}：{route ? `${Math.ceil(route.seconds / 60)} 分钟 ↗` : trip ? '无可用路线' : '待查询'}</button> })}{!!trip?.errors.length && <p className="commute-error">{trip.errors[0]}</p>}</div> })}</div></details>)}</div>
        {moving && <><h3>周边配套对照</h3><div className="life-pair">{[base, target].map(h => { const score = profileScore(s.profiles[h.id] ?? null, s.weights); return <div key={h.id}><small>{h.name}</small><strong>{!enabledCategories(s.weights).length ? '未启用评分' : score === null ? '正在等待结果' : `${score.toFixed(0)} / 100`}</strong></div> })}</div>
          {enabledCategories(s.weights).map(id => { const changes = s.changes[id]; return <details className="life-category" key={id}><summary>{categoryLabel(id)}<span>{changes ? `共同 ${changes.common.length} · 新增 ${changes.added.length} · 不再可达 ${changes.lost.length}` : '正在等待结果'}</span></summary>{changes?.error && <p className="commute-error">部分地点暂时无法比较，先看看已找到的结果。</p>}{changes && <>{[['共同可达', changes.common, target], ['新增可达', changes.added, target], ['搬家后不再可达', changes.lost, base]].map(([label, places, home]) => <div key={label as string}><p>{label as string}</p>{(places as ReachablePoi[]).length ? (places as ReachablePoi[]).map(p => <button className="commute-text-button" key={p.poi.id} onClick={() => inspectPoi(home as Home, p)}>{p.poi.name} ↗</button>) : <small>暂无</small>}</div>)}</>}</details> })}
          <p className="commute-note">这里只比较本次找到的地点；换个出行方式或时间范围，结果也会变化。</p>
          {[base, target].map(h => <details key={h.id}><summary>{h.name} · 配套与评分明细</summary><ProfileResults profile={s.profiles[h.id] ?? null} weights={s.weights} onSelect={p => inspectPoi(h, p)} /></details>)}
        </>}
      </div>}
      {s.inspection && <details className="life-selected" open><summary>{s.inspection.origin.name} → {s.inspection.destination.name}</summary><p>约 {Math.ceil(s.inspection.route.seconds / 60)} 分钟</p>{s.inspection.route.transitLegs?.length ? <TransitItinerary legs={s.inspection.route.transitLegs} onShowMap={() => useStore.getState().setDrawerOpen(false)} /> : <ol>{s.inspection.route.instructions.map((text, i) => <li key={i}>{text}</li>)}</ol>}</details>}
      <p className="commute-note">去程与回程耗时可能不同，高峰时段请多留一点时间。刷新页面后，比较记录会清空。</p>
    </>}
  </section>
}
