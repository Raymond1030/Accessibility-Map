import { COMMUTE_LABELS, COMMUTE_MODES, type CommuteMode } from '../commute/types'
import { CATEGORIES, categoryLabel, type CategoryId, type LifeProfile, type ReachablePoi, type Weights } from '../explore/types'
import { categoryScore, profileScore } from '../explore/profile'
import { TransitItinerary } from './TransitItinerary'

export function TravelSettings({ mode, minutes, onChange }: { mode: CommuteMode; minutes: number; onChange: (mode: CommuteMode, minutes: number) => void }) {
  return <>
    <div className="commute-mode-tabs" aria-label="出行方式">{COMMUTE_MODES.map(m => <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => onChange(m, minutes)}>{COMMUTE_LABELS[m]}</button>)}</div>
    <label className="life-time">单程时间上限 <strong>{minutes} 分钟</strong><input aria-label="单程时间上限" type="range" min="1" max="60" value={minutes} onChange={e => onChange(mode, Number(e.target.value))} /></label>
    <div className="range-presets">{[15, 30, 45, 60].map(m => <button key={m} aria-pressed={m === minutes} onClick={() => onChange(mode, m)}>{m} 分钟</button>)}</div>
  </>
}
export function WeightPicker({ weights, onChange }: { weights: Weights; onChange: (id: CategoryId, value: number) => void }) {
  return <details className="life-preferences" open><summary>配套偏好 <small>0 为不参与，5 为最看重</small></summary><div className="life-weights">{CATEGORIES.map(c => <label key={c.id}>{c.label}<select aria-label={`${c.label}权重`} value={weights[c.id]} onChange={e => onChange(c.id, Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 0 ? '不参与' : n}</option>)}</select></label>)}</div></details>
}
export function PoiCard({ place, onSelect, actions }: { place: ReachablePoi; onSelect: (p: ReachablePoi) => void; actions?: React.ReactNode }) {
  return <article className="life-poi"><div><button className="life-place-title" onClick={() => onSelect(place)}>{place.poi.name} <span aria-hidden="true">↗</span></button><small>{categoryLabel(place.poi.category)} · 约 {Math.ceil(place.route.seconds / 60)} 分钟 · {(place.route.meters / 1000).toFixed(1)} 公里</small><p>{place.poi.address || '暂无地址'}</p></div>{actions && <div className="life-poi-actions">{actions}</div>}</article>
}
export function ProfileResults({ profile, weights, onSelect }: { profile: LifeProfile | null; weights: Weights; onSelect: (p: ReachablePoi) => void }) {
  const score = profileScore(profile, weights)
  return <div className="life-results">
    {Object.values(weights).some(weight => weight > 0) ? <div className="life-score"><div><span>生活配套匹配分</span><strong>{score === null ? '—' : score.toFixed(0)}<small> / 100</small></strong></div><p>基于本次检索样本<br />数量与便利程度各占一半</p></div> : <p className="commute-note">全部类别权重为零，未启用配套评分。</p>}
    <details className="life-formula"><summary>评分怎么算</summary><p>每类最多核验 5 个候选。选择数量达到 3 处得满分；另一半按已核验地点中的最短耗时计算。各类按你的权重加权平均。</p><p>分类得分 = 100 × [0.5 × min(可达数量 ÷ 3, 1) + 0.5 × (1 − 最短耗时 ÷ 时间上限)]。无可达地点为 0 分；失败或未查询的类别不计为零分，暂不显示总分。全部权重为零时不显示总分。</p></details>
    {CATEGORIES.filter(c => weights[c.id] > 0).map(c => {
      const result = profile?.categories[c.id]; const score = categoryScore(result, profile?.query.minutes ?? 15)
      return <details className="life-category" key={c.id} open={!!result?.places.length}><summary>{c.label}<span>{result ? `查到 ${result.places.length} 处可达` : '待查询'} · {score === null ? '—' : `${score.toFixed(0)} 分`}</span></summary>
        {result?.message && <p className="commute-error">{result.message}，请重新生成补查。</p>}
        {result?.places.map(place => <PoiCard key={place.poi.id} place={place} onSelect={onSelect} />)}
        {result?.status === 'ok' && !result.places.length && <p className="commute-note">本次候选中未核验到符合时间条件的地点。</p>}
        {result && <p className="commute-note">已完成 {result.checked} 个候选的路线核验{result.truncated ? ' · 候选已截取' : ''}，并非全部配套数量。</p>}
      </details>
    })}
  </div>
}
export function SelectedRoute({ place, onShowMap }: { place: ReachablePoi | null; onShowMap: () => void }) {
  if (!place) return null
  return <section className="life-selected"><h3>去 {place.poi.name}</h3>{place.origin && <p>出发点：{place.origin.name}</p>}<p>约 {Math.ceil(place.route.seconds / 60)} 分钟 · {(place.route.meters / 1000).toFixed(1)} 公里</p><button className="commute-text-button" onClick={onShowMap}>查看地图路线 →</button>
    {place.route.transitLegs?.length ? <TransitItinerary legs={place.route.transitLegs} onShowMap={onShowMap} /> : <ol>{place.route.instructions.map((s, i) => <li key={i}>{s}</li>)}</ol>}
    {!place.route.paths.length && <p className="commute-note">服务未返回路线轨迹。</p>}
    <small>高德估算 · {new Date(place.route.fetchedAt).toLocaleTimeString('zh-CN')} 查询</small>
  </section>
}
