import { useEffect, useRef, useState } from 'react'
import { SearchBox } from './SearchBox'
import { useStore } from '../state/store'
import { computeBand } from '../state/compute'
import { formatArea } from '../geometry/result'
import { downloadGeoJSON, type ExportItem } from '../export'
import { cellKey, MAX_MINUTES, MODE_LABEL, type Mode, type SetOp } from '../types'
import { useIsMobile } from '../ui/responsive'
import './Sidebar.css'

const OP_LABEL: Record<SetOp, string> = {
  intersect: '∩ 交集', union: '∪ 并集', difference: '− 差集',
}
const EMPTY_TEXT: Record<SetOp, string> = {
  intersect: '无共同可达区',
  union: '无可达区域',
  difference: '基准点范围已被完全覆盖',
}

/**
 * 1–60 分钟滑条。拖动中只更新本地读数，松手（或按键抬起）才提交——
 * 一次拖动会产生几十次 change，每次都提交就是几十个等时圈请求。
 */
function MinuteSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value)
  const dragging = useRef(false)
  // 外部换档（比如点了预设 chip）时跟随，但不打断拖动中的读数
  useEffect(() => { if (!dragging.current) setDraft(value) }, [value])
  const commit = () => {
    dragging.current = false
    if (draft !== value) onCommit(draft)
  }
  return (
    <>
      <input
        type="range"
        min={1}
        max={MAX_MINUTES}
        step={1}
        value={draft}
        aria-label="自定义时间（分钟）"
        onPointerDown={() => { dragging.current = true }}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="slider-val">{draft} 分</span>
    </>
  )
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
    if (visibleIds.length === 0) return '添加一个起点开始'
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
              value={o.mode}
              onChange={(e) => s.setMode(o.id, e.target.value as Mode)}
            >
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <option key={m} value={m}>{MODE_LABEL[m]}</option>
              ))}
            </select>

            {s.bandMode === 'custom' && (
              <>
                <div className="chips">
                  {[15, 30, 45, 60].map((m) => (
                    <button
                      key={m}
                      className={o.thresholds.includes(m) ? 'chip on' : 'chip'}
                      onClick={() => s.updateOrigin(o.id, { thresholds: [m] })}
                    >{m}</button>
                  ))}
                </div>
                <div className="slider-row">
                  <MinuteSlider
                    value={o.thresholds[0] ?? 30}
                    onCommit={(v) => s.updateOrigin(o.id, { thresholds: [v] })}
                  />
                </div>
              </>
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
                  return <span key={m} className="tag muted">{m} 分钟：周边无可达路网</span>
                }
                if (st === 'loading') return <span key={m} className="tag">{m} 分钟：计算中</span>
                return null
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="pane controls">
        <h2>{visibleIds.length >= 2 ? '运算' : '时间档位'}</h2>
        {/* 只有一个起点时三种运算结果完全相同（都等于它自己的可达范围），
            露出切换只会让人以为选错了 */}
        {visibleIds.length >= 2 && (
          <div className="chips">
            {(Object.keys(OP_LABEL) as SetOp[]).map((op) => (
              <button
                key={op}
                className={s.op === op ? 'chip on' : 'chip'}
                onClick={() => s.setOp(op)}
              >{OP_LABEL[op]}</button>
            ))}
          </div>
        )}

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
          <>
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
            <div className="slider-row">
              <button
                className={s.globalThresholds.includes(s.customMinutes) ? 'chip on' : 'chip'}
                onClick={() => s.setGlobalThresholds(
                  s.globalThresholds.includes(s.customMinutes)
                    ? s.globalThresholds.filter((x) => x !== s.customMinutes)
                    : [...s.globalThresholds, s.customMinutes].sort((a, b) => a - b),
                )}
              >自定义</button>
              <MinuteSlider value={s.customMinutes} onCommit={s.setCustomMinutes} />
            </div>
          </>
        )}

        {s.op === 'difference' && visibleIds.length >= 2 && (
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
        <h2>{visibleIds.length === 1 ? '可达范围' : '结果'}</h2>
        {visibleIds.length === 0 && <p className="hint">添加起点后显示可达范围</p>}

        {visibleIds.length >= 1 && results.map(({ minutes, result }) => (
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
