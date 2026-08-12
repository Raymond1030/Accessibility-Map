import { SearchBox } from './SearchBox'
import { useStore } from '../state/store'
import { computeBand } from '../state/compute'
import { formatArea } from '../geometry/result'
import { downloadGeoJSON, type ExportItem } from '../export'
import { cellKey, MAX_MINUTES, type SetOp, type TransitPolicy } from '../types'
import { useIsMobile } from '../ui/responsive'
import './Sidebar.css'

const OP_LABEL: Record<SetOp, string> = {
  intersect: '∩ 交集', union: '∪ 并集', difference: '− 差集',
}
const POLICY_LABEL: Record<TransitPolicy, string> = {
  ALL: '公交+地铁', SUBWAY: '只坐地铁', BUS: '只坐公交',
}
const EMPTY_TEXT: Record<SetOp, string> = {
  intersect: '无共同可达区',
  union: '无可达区域',
  difference: '基准点范围已被完全覆盖',
}

export function Sidebar() {
  const s = useStore()
  const visible = s.origins.filter((o) => o.visible)
  const visibleIds = visible.map((o) => o.id)
  const bands = s.bandMode === 'paired' ? s.globalThresholds : [s.globalThresholds[0]]

  const results = bands.map((minutes) => ({
    minutes,
    result: computeBand({
      op: s.op, minutes, originIds: visibleIds,
      cells: s.cells, geoms: s.geoms, baseOriginId: s.baseOriginId,
    }),
  }))

  const exportable: ExportItem[] = results
    .filter((r) => r.result.kind === 'ok')
    .map((r) => ({ minutes: r.minutes, feature: (r.result as any).geometry }))

  const nameOf = (id: string) => s.origins.find((o) => o.id === id)?.label ?? id

  const isMobile = useIsMobile()

  // 折叠时只露这一行，所以要挑最有信息量的那档：优先第一个算出结果的，
  // 否则退回第一档的状态描述。没有它，折叠状态下用户完全不知道发生了什么。
  const summary = (() => {
    if (visibleIds.length < 2) return '至少需要两个起点'
    const hit = results.find((r) => r.result.kind === 'ok')
    if (hit && hit.result.kind === 'ok') {
      return `${hit.minutes} 分钟 · ${formatArea(hit.result.areaSqM)}`
    }
    const first = results[0]
    if (!first) return '选择时间档位'
    if (first.result.kind === 'loading') return '计算中'
    if (first.result.kind === 'empty') return `${first.minutes} 分钟 · ${EMPTY_TEXT[s.op]}`
    return '数据不全，无法计算'
  })()

  return (
    <aside className={s.drawerOpen ? 'sidebar' : 'sidebar collapsed'}>
      {/* 只在移动端显示（由 CSS 控制），点击切换抽屉两档 */}
      <button className="drawer-handle" onClick={s.toggleDrawer}>
        <span className="grip" />
        <span className="summary">{summary}</span>
        <span className="caret">{s.drawerOpen ? '▾' : '▴'}</span>
      </button>

      <section className="pane origins">
        <h2>起点</h2>
        <SearchBox />
        {isMobile && (
          <button
            className={s.pickingMode ? 'pick-btn on' : 'pick-btn'}
            onClick={() => s.setPickingMode(!s.pickingMode)}
          >
            {s.pickingMode ? '选点中，点击地图落点' : '＋ 在地图上加点'}
          </button>
        )}
        {s.origins.length === 0 && <p className="hint">在地图上点击，或搜索地点来添加起点</p>}

        {s.origins.map((o) => (
          <div className="origin-card" key={o.id} style={{ borderLeftColor: o.color }}>
            <header>
              <input
                className="label-input"
                value={o.label}
                onChange={(e) => s.updateOrigin(o.id, { label: e.target.value })}
              />
              <button className="icon" title="删除" onClick={() => s.removeOrigin(o.id)}>×</button>
            </header>

            <label className="row">
              <input
                type="checkbox"
                checked={o.visible}
                onChange={(e) => s.updateOrigin(o.id, { visible: e.target.checked })}
              />
              参与运算
            </label>

            <select
              value={o.policy}
              onChange={(e) => s.setPolicy(o.id, e.target.value as TransitPolicy)}
            >
              {(Object.keys(POLICY_LABEL) as TransitPolicy[]).map((p) => (
                <option key={p} value={p}>{POLICY_LABEL[p]}</option>
              ))}
            </select>

            {s.bandMode === 'custom' && (
              <div className="chips">
                {[15, 30, 45, 60].map((m) => (
                  <button
                    key={m}
                    className={o.thresholds.includes(m) ? 'chip on' : 'chip'}
                    onClick={() => s.updateOrigin(o.id, { thresholds: [m] })}
                  >{m}</button>
                ))}
              </div>
            )}

            <div className="cell-status">
              {(s.bandMode === 'paired' ? s.globalThresholds : o.thresholds).map((m) => {
                const st = s.cells.get(cellKey(o.id, m))
                if (st === 'error') {
                  return (
                    <button key={m} className="retry" onClick={() => void s.retryCell(o.id, m)}>
                      {m} 分钟失败，重试
                    </button>
                  )
                }
                if (st === 'empty') {
                  return <span key={m} className="tag muted">{m} 分钟：周边无公交可达数据</span>
                }
                if (st === 'loading') return <span key={m} className="tag">{m} 分钟：计算中</span>
                return null
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="pane controls">
        <h2>运算</h2>
        <div className="chips">
          {(Object.keys(OP_LABEL) as SetOp[]).map((op) => (
            <button
              key={op}
              className={s.op === op ? 'chip on' : 'chip'}
              onClick={() => s.setOp(op)}
            >{OP_LABEL[op]}</button>
          ))}
        </div>

        <div className="chips">
          <button
            className={s.bandMode === 'paired' ? 'chip on' : 'chip'}
            onClick={() => s.setBandMode('paired')}
          >同档配对</button>
          <button
            className={s.bandMode === 'custom' ? 'chip on' : 'chip'}
            onClick={() => s.setBandMode('custom')}
          >自定义</button>
        </div>

        {s.bandMode === 'paired' && (
          <div className="chips">
            {[15, 30, 45, MAX_MINUTES].map((m) => (
              <button
                key={m}
                className={s.globalThresholds.includes(m) ? 'chip on' : 'chip'}
                onClick={() => s.setGlobalThresholds(
                  s.globalThresholds.includes(m)
                    ? s.globalThresholds.filter((x) => x !== m)
                    : [...s.globalThresholds, m].sort((a, b) => a - b),
                )}
              >{m} 分钟</button>
            ))}
          </div>
        )}

        {s.op === 'difference' && (
          <label className="row">
            基准点
            <select
              value={s.baseOriginId ?? ''}
              onChange={(e) => s.setBaseOrigin(e.target.value || null)}
            >
              <option value="">请选择</option>
              {s.origins.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="pane results">
        <h2>结果</h2>
        {visibleIds.length < 2 && <p className="hint">至少需要两个参与运算的起点</p>}

        {visibleIds.length >= 2 && results.map(({ minutes, result }) => (
          <div className="result-row" key={minutes}>
            <b>{minutes} 分钟</b>
            {result.kind === 'ok' && <span className="ok">{formatArea(result.areaSqM)}</span>}
            {result.kind === 'empty' && <span className="muted">{EMPTY_TEXT[s.op]}</span>}
            {result.kind === 'loading' && <span className="muted">计算中</span>}
            {result.kind === 'unavailable' && (
              <span className="warn">
                数据不全，无法计算（缺 {result.missing.map(nameOf).join('、') || '基准点'}）
              </span>
            )}
          </div>
        ))}

        {exportable.length > 0 && (
          <button className="export" onClick={() => downloadGeoJSON(exportable)}>
            导出 GeoJSON
          </button>
        )}
      </section>
    </aside>
  )
}
