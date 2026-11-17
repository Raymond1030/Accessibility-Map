import { metroLineColor, metroLineLabel } from '../transit/lineColors'
import { contrastText } from '../ui/mapStyle'
import { metroRangeInfo } from '../providers/metroWalking'
import { areaOf, formatArea } from '../geometry/result'
import { RANGE_COLORS, RANGE_LABELS, RANGE_MODES } from '../commute/range'
import { useCommute } from '../commute/store'
import { useStore } from '../state/store'
import { isLocalEngineEnabled } from '../providers/local'
import { LocalEngineStatus, LocalQueryInputs } from './LocalEnginePanel'
import type { RangeMode } from '../commute/range'

export function WorkplaceRange() {
  const s = useCommute()
  const result = s.rangeResult
  const metro = result.status === 'ok' ? metroRangeInfo(result.geometry) : null
  const isMetro = s.rangeMode === 'subway-walking'
  const local = isLocalEngineEnabled()
  const modes: readonly RangeMode[] = local ? [...RANGE_MODES, 'transit-walking'] : RANGE_MODES
  const isTransit = s.rangeMode === 'transit-walking'
  return <section className="commute-section workplace-range">
    <h2><span className="step-no" aria-hidden="true">2</span>看多远的生活圈</h2>
    {local && <LocalEngineStatus />}
    <div className="commute-mode-tabs" aria-label="通勤圈出行方式">{modes.map(mode => <button key={mode}
      aria-pressed={s.rangeMode === mode} className={s.rangeMode === mode ? 'active' : ''}
      onClick={() => s.setRangeMode(mode)}>{RANGE_LABELS[mode]}</button>)}</div>
    {local && !isMetro && <LocalQueryInputs direction={s.rangeDirection} onDirectionChange={s.setRangeDirection}
      {...(isTransit ? { dateTime: s.rangeDateTime, onDateTimeChange: s.setRangeDateTime } : {})} />}
    <label className="range-time-label" htmlFor="workplace-minutes">时间范围 <strong>{s.rangeMinutes} 分钟</strong></label>
    <input id="workplace-minutes" type="range" min="1" max="60" value={s.rangeMinutes}
      onChange={e => s.setRangeMinutes(Number(e.target.value))} />
    <div className="range-presets">{[15, 30, 45, 60].map(minutes => <button key={minutes}
      aria-pressed={s.rangeMinutes === minutes} onClick={() => s.setRangeMinutes(minutes)}>{minutes} 分钟</button>)}</div>
    <button className="commute-primary" disabled={!s.workplace || result.status === 'loading'}
      onClick={() => void s.evaluateRange()}>{result.status === 'loading' ? '正在生成通勤圈…' : result.status === 'error' ? '重试生成通勤圈' : '生成通勤圈'}</button>
    <p className="range-direction"><strong>{isMetro ? '到达工作地 · 地铁＋步行' : local ? `${s.rangeDirection === 'arrive' ? '到达工作地' : '从工作地出发'}` : '从工作地出发 · 通勤参考范围'}</strong><br />{isMetro
      ? '仅深圳。两端步行各最多 15 分钟，包含进出站、候车、换乘和纯步行可达区。'
      : isTransit ? '公交线路可能不全，香港地区暂不含港铁重铁。'
      : local ? '不含实时拥堵、停车或跨境通关等待时间。'
      : '往返路线可能不同，选好小区后可在「比较住处」中查看到公司的耗时。'}</p>
    <div className="range-result" aria-live="polite">
      {result.status === 'idle' && <p className="commute-empty">{s.workplace ? '选好方式和时间，看看附近能住哪里。' : '先添加工作地，即可查看通勤圈。'}<br />无需添加候选住处。</p>}
      {result.status === 'loading' && <p>正在寻找 {s.rangeMinutes} 分钟内能到的地方…</p>}
      {result.status === 'empty' && <p className="commute-empty">此位置暂无{RANGE_LABELS[s.rangeMode]}可达范围。试试调整时间、工作地或出行方式。</p>}
      {result.status === 'error' && <p className="commute-error" role="alert">{result.message}</p>}
      {result.status === 'ok' && <div className="range-success">
        <span className="range-swatch" style={{ background: RANGE_COLORS[s.rangeMode] }} />
        <div><strong>{RANGE_LABELS[s.rangeMode]} · {s.rangeMinutes} 分钟</strong><p>覆盖约 {formatArea(areaOf(result.geometry))}</p>
        </div>
        <button onClick={() => useStore.getState().setDrawerOpen(false)}>查看地图</button>
      </div>}
    </div>
    {metro && <div className="metro-network-summary">
      <strong>{metro.lines.length ? `覆盖 ${new Set(metro.stations.map(station => station.name)).size} 座车站` : '本次范围仅含纯步行可达区'}</strong>
      <div className="metro-line-legend" aria-label="可达地铁线路">{metro.lines.map(line => <span key={line}
        style={{ backgroundColor: metroLineColor(line), color: contrastText(metroLineColor(line)) }}>{metroLineLabel(line)}</span>)}</div>
      <p>线路按深圳地铁配色显示；圆点为可接驳车站，虚线为站间连接示意。</p>
      <details><summary>线路说明</summary><small>线网日期：{metro.dataDate} · OSM / ODbL</small>
        {metro.limitations.map(note => <p className="commute-note" key={note}>{note}</p>)}</details>
    </div>}
    <details className="commute-note"><summary>范围说明</summary><p>{isMetro
      ? '包含步行、候车和换乘时间，暂不考虑实时班次与首末班车。两端步行各最多 15 分钟。'
      : '范围供选址参考，实际耗时会受路况影响。河岸和道路较少的地方，请以具体路线为准。'}</p>
      <small>数据来源：{local ? 'GraphHopper · OpenStreetMap / Geofabrik · GTFS' : 'Mapbox'}{isMetro ? ' · 深圳地铁线网' : ''}</small></details>
    <button className="commute-text-button" onClick={() => s.setView('compare')}>有心仪的小区了？比较到公司的实际路线 →</button>
  </section>
}
