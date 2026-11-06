import { metroLineColor, metroLineLabel } from '../transit/lineColors'
import { contrastText } from '../ui/mapStyle'
import { metroRangeInfo } from '../providers/metroWalking'
import { areaOf, formatArea } from '../geometry/result'
import { RANGE_COLORS, RANGE_LABELS, RANGE_MODES } from '../commute/range'
import { useCommute } from '../commute/store'
import { useStore } from '../state/store'

export function WorkplaceRange() {
  const s = useCommute()
  const result = s.rangeResult
  const metro = result.status === 'ok' ? metroRangeInfo(result.geometry) : null
  const isMetro = s.rangeMode === 'subway-walking'
  return <section className="commute-section workplace-range">
    <h2><span>02</span> 看多远的生活圈</h2>
    <div className="commute-mode-tabs" aria-label="通勤圈出行方式">{RANGE_MODES.map(mode => <button key={mode}
      aria-pressed={s.rangeMode === mode} className={s.rangeMode === mode ? 'active' : ''}
      onClick={() => s.setRangeMode(mode)}>{RANGE_LABELS[mode]}</button>)}</div>
    <label className="range-time-label" htmlFor="workplace-minutes">时间范围 <strong>{s.rangeMinutes} 分钟</strong></label>
    <input id="workplace-minutes" type="range" min="1" max="60" value={s.rangeMinutes}
      onChange={e => s.setRangeMinutes(Number(e.target.value))} />
    <div className="range-presets">{[15, 30, 45, 60].map(minutes => <button key={minutes}
      aria-pressed={s.rangeMinutes === minutes} onClick={() => s.setRangeMinutes(minutes)}>{minutes} 分钟</button>)}</div>
    <button className="commute-primary" disabled={!s.workplace || result.status === 'loading'}
      onClick={() => void s.evaluateRange()}>{result.status === 'loading' ? '正在生成通勤圈…' : result.status === 'error' ? '重试生成通勤圈' : '生成通勤圈'}</button>
    <p className="range-direction"><strong>{isMetro ? '到达工作地 · 地铁＋步行估算' : '从工作地出发 · 通勤参考范围'}</strong><br />{isMetro
      ? '仅深圳。两端步行各最多 15 分钟，包含进出站、候车、换乘和纯步行可达区。'
      : '上班反向路线可能不同，具体住处到公司的耗时可在「比较住处」中核验。'}</p>
    <div className="range-result" aria-live="polite">
      {result.status === 'idle' && <p className="commute-empty">{s.workplace ? '选择方式和时间，生成工作地周边等时圈。' : '先添加工作地，即可查看通勤圈。'}<br />无需添加候选住处。</p>}
      {result.status === 'loading' && <p>{result.message ?? `正在计算 ${RANGE_LABELS[s.rangeMode]} ${s.rangeMinutes} 分钟范围…`}</p>}
      {result.status === 'empty' && <p className="commute-empty">此位置暂无{RANGE_LABELS[s.rangeMode]}可达范围。试试调整时间、工作地或出行方式。</p>}
      {result.status === 'error' && <p className="commute-error" role="alert">{result.message}</p>}
      {result.status === 'ok' && <div className="range-success">
        <span className="range-swatch" style={{ background: RANGE_COLORS[s.rangeMode] }} />
        <div><strong>{RANGE_LABELS[s.rangeMode]} · {s.rangeMinutes} 分钟</strong><p>覆盖约 {formatArea(areaOf(result.geometry))}</p></div>
        <button onClick={() => useStore.getState().setDrawerOpen(false)}>查看地图</button>
      </div>}
    </div>
    {metro && <div className="metro-network-summary">
      <strong>{metro.lines.length ? `覆盖 ${new Set(metro.stations.map(station => station.name)).size} 座车站` : '本次范围仅含纯步行可达区'}</strong>
      <div className="metro-line-legend" aria-label="可达地铁线路">{metro.lines.map(line => <span key={line}
        style={{ backgroundColor: metroLineColor(line), color: contrastText(metroLineColor(line)) }}>{metroLineLabel(line)}</span>)}</div>
      <p>线路按深圳地铁配色显示；圆点为可接驳车站，虚线为站间连接示意。</p>
      <small>线网快照：{metro.dataDate} · OSM / ODbL</small>
      {metro.limitations.map(note => <p className="commute-note" key={note}>{note}</p>)}
    </div>}
    <p className="commute-note">{isMetro
      ? '本地地铁寻路引擎＋Mapbox 步行路网。按平均班距 5 分钟、进出站各 2 分钟、换乘走行 4 分钟估算；区间时间按站距估算，步行按双向可通行近似。非实时班次，不含首末班车限制。'
      : '数据来源：Mapbox 路网等时圈。范围为估算，不代表固定早高峰或指定到达时刻。'}</p>
    <button className="commute-text-button" onClick={() => s.setView('compare')}>有心仪的小区了？比较到公司的实际路线 →</button>
  </section>
}
