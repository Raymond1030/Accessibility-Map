import { useState } from 'react'
import { PlacePicker } from './PlacePicker'
import { ComparisonPanel } from './ComparisonPanel'
import { useExplore } from '../explore/store'
import { useNavigation } from '../state/navigation'
import { useComparison } from '../commute/comparisonStore'
import { useCommute } from '../commute/store'
import { COMMUTE_LABELS, COMMUTE_MODES, eligibility, routeKey, type RouteCell } from '../commute/types'
import { useStore } from '../state/store'
import './CommutePanel.css'
import { TransitItinerary } from './TransitItinerary'
import { WorkplaceRange } from './WorkplaceRange'
import { RANGE_LABELS } from '../commute/range'

function duration(cell?: RouteCell) {
  if (!cell) return '待计算'
  if (cell.status === 'loading') return '计算中…'
  if (cell.status === 'error') return '查询失败'
  if (cell.status === 'empty') return '暂无路线'
  return `${Math.ceil(cell.route.seconds / 60)} 分钟`
}
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} 米` : `${(meters / 1000).toFixed(1)} 公里`

export function CommutePanel() {
  const s = useCommute()
  const drawerOpen = useStore(s => s.drawerOpen)
  const toggleDrawer = useStore(s => s.toggleDrawer)
  const [onlyEligible, setOnlyEligible] = useState(false)
  const [sort, setSort] = useState('time')
  const ready = !!s.workplace && !!s.homes.length && !!s.city.trim() && !!s.destinationCity.trim()
  const passed = s.homes.filter(h => eligibility(h, s.cells[routeKey(h.id, s.mode)], s.minutes, s.budget) === '符合条件').length
  const homes = [...s.homes].filter(h => !onlyEligible || eligibility(h, s.cells[routeKey(h.id, s.mode)], s.minutes, s.budget) === '符合条件')
    .sort((a, b) => {
      if (sort === 'rent') return (a.rent ?? Infinity) - (b.rent ?? Infinity)
      const ac = s.cells[routeKey(a.id, s.mode)], bc = s.cells[routeKey(b.id, s.mode)]
      return (ac?.status === 'ok' ? ac.route.seconds : Infinity) - (bc?.status === 'ok' ? bc.route.seconds : Infinity)
    })
  function pick(target: 'work' | 'home') {
    s.setPicking(s.picking === target ? null : target)
    useStore.getState().setDrawerOpen(false)
  }
  return <aside className={`sidebar commute-panel${drawerOpen ? '' : ' collapsed'}`}>
    <button className="drawer-handle" onClick={toggleDrawer} aria-expanded={drawerOpen}>
      <span className="grip" /><span className="summary">{s.view === 'range' ? `通勤圈 · ${RANGE_LABELS[s.rangeMode]} ${s.rangeMinutes} 分钟${s.rangeResult.status === 'loading' ? ' · 计算中' : s.rangeResult.status === 'ok' ? '' : ' · 尚未生成'}` : s.view === 'move' ? `搬家对比 · ${s.homes.length} 个候选住处` : `租房通勤 · ${passed} / ${s.homes.length} 处符合条件`}</span><span className="caret">{drawerOpen ? '⌄' : '⌃'}</span>
    </button>
    <div className="commute-scroll">
      <header className="commute-intro"><span className="eyebrow">{s.view === 'range' ? 'WORK · REACHABILITY' : 'HOME → WORK'}</span><h1>{s.view === 'range' ? '从工作地，看看住哪里' : '把时间留给生活'}</h1><p>{s.view === 'range' ? '只选工作地和时间，先看周边通勤范围。' : '比较候选住处，找到租得起、通勤也轻松的家。'}</p></header>
      <div className="commute-view-tabs has-moving" aria-label="通勤查看方式">
        <button aria-pressed={s.view === 'range'} onClick={() => s.setView('range')}>看通勤圈</button>
        <button aria-pressed={s.view === 'compare'} onClick={() => s.setView('compare')}>比较住处</button>
        <button aria-pressed={s.view === 'move'} onClick={() => s.setView('move')}>搬家对比</button>
      </div>
      <section className="commute-section">
        <h2><span>01</span> 公司在哪里</h2>
        <div className="commute-fields">
          {s.view !== 'range' && <label>居住城市<input value={s.city} onChange={e => s.setCities(e.target.value, s.destinationCity)} placeholder="如：深圳" /></label>}
          <label>工作城市<input value={s.destinationCity} onChange={e => s.setCities(s.city, e.target.value)} placeholder="如：深圳" /></label>
        </div>
        <PlacePicker key={`work:${s.destinationCity}`} label="搜索公司或办公楼" city={s.destinationCity} onSelect={s.setWorkplace} />
        <button className="commute-text-button" onClick={() => pick('work')}>{s.picking === 'work' ? '取消选点' : '＋ 在地图上标记公司'}</button>
        {s.workplace && <div className="workplace"><span>班</span><div><strong>{s.workplace.name}</strong><small>{s.view === 'range' ? (s.rangeMode === 'subway-walking' ? '通勤终点 · 计算到达这里的范围' : '等时圈中心 · 从这里出发') : '通勤终点 · 可重新搜索或选点替换'}</small></div></div>}
      </section>
      {s.view === 'range' ? <WorkplaceRange /> : s.view === 'move' ? <ComparisonPanel moving /> : <>
      <section className="commute-section">
        <h2><span>02</span> 添加候选住处 <small>{s.homes.length} / 6</small></h2>
        <PlacePicker key={`home:${s.city}`} label="搜索小区或房源地址" city={s.city} onSelect={s.addHome} disabled={s.homes.length >= 6 || s.busy} />
        <button className="commute-text-button" disabled={s.homes.length >= 6 || s.busy} onClick={() => pick('home')}>{s.picking === 'home' ? '取消选点' : '＋ 在地图上标记住处'}</button>
        <p className="commute-note">手动添加你正在考虑的住处，租金由你填写。</p>
      </section>
      <section className="commute-section">
        <h2><span>03</span> 你的通勤偏好</h2>
        <div className="commute-fields">
          <label>单程上限（分钟）<input type="number" min="1" max="180" value={s.minutes} onChange={e => useCommute.setState({ minutes: Math.max(1, Math.min(180, Number(e.target.value) || 1)) })} /></label>
          <label>月租预算（元）<input type="number" min="0" step="100" value={s.budget ?? ''} placeholder="不限" onChange={e => useCommute.setState({ budget: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} /></label>
        </div>
        <div className="commute-mode-tabs" aria-label="用于筛选和排序的出行方式">{COMMUTE_MODES.map(mode => <button key={mode} aria-pressed={s.mode === mode} className={s.mode === mode ? 'active' : ''} onClick={() => useCommute.setState({ mode })}>{COMMUTE_LABELS[mode]}</button>)}</div>
        <button className="commute-primary" disabled={!ready || s.busy} onClick={() => void s.evaluate()}>{s.busy ? '正在查询高德路线…' : Object.keys(s.cells).length ? '重新计算全部通勤' : '比较通勤路线'}</button>
        <p className="commute-note">每个住处比较 4 种方式，最多 24 次查询。筛选、排序及切换方式无需重新查询。</p>
      </section>
      <section className="commute-section commute-results" aria-live="polite">
        <h2>候选住处 <small>{passed} 处符合条件</small></h2>
        {!!s.homes.length && <div className="commute-result-tools"><label><input type="checkbox" checked={onlyEligible} onChange={e => setOnlyEligible(e.target.checked)} />只看符合条件</label><select aria-label="候选住处排序" value={sort} onChange={e => setSort(e.target.value)}><option value="time">通勤最快</option><option value="rent">租金最低</option></select></div>}
        {!s.homes.length && <div className="commute-empty">从公司和第一个候选住处开始。<br />路线将按「住处 → 公司」计算。</div>}
        {!!s.homes.length && !homes.length && <p className="commute-empty">暂无符合条件的住处。可取消筛选查看原因。</p>}
        {homes.map(home => {
          const cell = s.cells[routeKey(home.id, s.mode)]
          const verdict = eligibility(home, cell, s.minutes, s.budget)
          const route = cell?.status === 'ok' ? cell.route : null
          return <article key={home.id} className={`home-card${s.selectedId === home.id ? ' selected' : ''}`}>
            <div className="home-heading"><button onClick={() => s.select(home.id)} title="在地图查看">{home.name}</button><button className="home-remove" aria-label={`删除${home.name}`} onClick={() => s.removeHome(home.id)}>×</button></div>
            <div className="home-meta"><label>月租 ¥ <input aria-label={`${home.name}月租`} type="number" min="0" step="100" placeholder="待填写" value={home.rent ?? ''} onChange={e => s.setRent(home.id, e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} /></label><span className={`verdict${verdict === '符合条件' ? ' pass' : ''}`}>{verdict}</span></div>
            <div className="life-inline-actions"><button className="commute-text-button" onClick={() => { useExplore.getState().setView('profile'); useExplore.getState().setCenter(home, s.city); useNavigation.getState().setScene('explore') }}>查看生活画像 →</button><button className="commute-text-button" onClick={() => { useComparison.getState().setPair(home.id, null); s.setView('move') }}>设为搬家比较基准</button></div>
            <div className="home-routes">{COMMUTE_MODES.map(mode => <button key={mode} className={s.mode === mode ? 'active' : ''} onClick={() => s.select(home.id, mode)} aria-pressed={s.mode === mode}><small>{COMMUTE_LABELS[mode]}</small><strong>{duration(s.cells[routeKey(home.id, mode)])}</strong></button>)}</div>
            {cell?.status === 'error' && <p className="commute-error">{cell.message}</p>}
            {cell?.status === 'empty' && <p className="commute-note">此方式暂无可用路线，可尝试其他方式。</p>}
            {route && <>
              <p className="route-facts">{distance(route.meters)}{route.transfers !== undefined && ` · 换乘 ${route.transfers} 次`}{route.walkingMeters !== undefined && ` · 步行 ${distance(route.walkingMeters)}`}{route.fare !== undefined && ` · 票价约 ¥${route.fare}`}</p>
              {!!route.transitLegs?.length && <TransitItinerary legs={route.transitLegs} onShowMap={() => { s.select(home.id); useStore.getState().setDrawerOpen(false) }} />}
              <details><summary onClick={() => s.select(home.id)}>路线详情 · 查看地图</summary>{route.instructions.length ? <ol>{route.instructions.map((text, i) => <li key={i}>{text}</li>)}</ol> : <p>高德未返回逐段说明。</p>}{!route.paths.length && <p>高德未返回路线轨迹。</p>}<small>高德估算 · {new Date(route.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 查询</small></details>
            </>}
          </article>
        })}
      </section>
      <ComparisonPanel />
      <footer className="commute-note commute-footer">耗时为查询时的路线估算，不代表固定早高峰或到达时刻保证。公交包含步行接驳；驾车未额外计入找车位时间。当前候选列表仅保留在本次页面会话中。</footer>
      </>}
    </div>
  </aside>
}
