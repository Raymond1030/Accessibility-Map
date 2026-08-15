import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { SearchBox } from './SearchBox'
import { useStore } from '../state/store'
import { computeBand } from '../state/compute'
import { formatArea } from '../geometry/result'
import { downloadGeoJSON, type ExportItem } from '../export'
import { cellKey, MAX_MINUTES, MODE_LABEL, type Mode, type SetOp } from '../types'
import { useIsMobile } from '../ui/responsive'
import {
  RESULT_COLOR,
  colorWithAlpha,
  contrastText,
  originBandOpacity,
  originCode,
  resultBandOpacity,
} from '../ui/mapStyle'
import './Sidebar.css'

const OP_LABEL: Record<SetOp, string> = {
  intersect: '∩ 交集', union: '∪ 并集', difference: '− 差集',
}
const EMPTY_TEXT: Record<SetOp, string> = {
  intersect: '无共同可达区',
  union: '无可达区域',
  difference: '基准点范围已被完全覆盖',
}

/** 1–60 分钟滑条。拖动时只更新读数，松手或键盘操作结束时才提交请求。 */
function MinuteSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value)
  const dragging = useRef(false)

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
        aria-valuetext={`${draft} 分钟`}
        onPointerDown={() => { dragging.current = true }}
        onChange={(event) => setDraft(Number(event.target.value))}
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
  const visible = s.origins.filter((origin) => origin.visible)
  const visibleIds = visible.map((origin) => origin.id)
  const bands = s.bandMode === 'paired' ? s.globalThresholds : [s.globalThresholds[0]]

  const results = bands.map((minutes) => ({
    minutes,
    result: computeBand({
      op: s.op,
      minutes,
      originIds: visibleIds,
      cells: s.cells,
      geoms: s.geoms,
      baseOriginId: s.baseOriginId,
    }),
  }))

  const exportable: ExportItem[] = results
    .filter((item) => item.result.kind === 'ok')
    .map((item) => ({ minutes: item.minutes, feature: (item.result as any).geometry }))

  const nameOf = (id: string) => s.origins.find((origin) => origin.id === id)?.label ?? id
  const isMobile = useIsMobile()

  const summary = (() => {
    if (visibleIds.length === 0) return '添加一个地点开始'
    const hit = results.find((item) => item.result.kind === 'ok')
    if (hit && hit.result.kind === 'ok') {
      return `${hit.minutes} 分钟 · ${formatArea(hit.result.areaSqM)}`
    }
    const first = results[0]
    if (!first) return '选择时间档位'
    if (first.result.kind === 'loading') return '正在计算可达范围'
    if (first.result.kind === 'empty') return `${first.minutes} 分钟 · ${EMPTY_TEXT[s.op]}`
    return '数据不全，无法计算'
  })()

  return (
    <aside className={s.drawerOpen ? 'sidebar' : 'sidebar collapsed'}>
      <button className="drawer-handle" onClick={s.toggleDrawer} aria-expanded={s.drawerOpen}>
        <span className="grip" />
        <span className="summary">{summary}</span>
        <span className="caret" aria-hidden="true">{s.drawerOpen ? '▾' : '▴'}</span>
      </button>

      <section className="pane origins">
        <div className="sidebar-intro">
          <div className="product-signature" aria-hidden="true"><i /><i /><i /></div>
          <div>
            <p className="eyebrow">ACCESS / REACH</p>
            <h1>可达性地图</h1>
            <p className="intro-copy">用颜色认地点，用深浅读时间。</p>
          </div>
        </div>

        <div className="section-heading">
          <h2>地点与图层</h2>
          <span>{visible.length} / {s.origins.length || 0} 已参与</span>
        </div>

        <SearchBox />

        {isMobile && (
          <button
            className={s.pickingMode ? 'pick-btn on' : 'pick-btn'}
            onClick={() => s.setPickingMode(!s.pickingMode)}
            aria-pressed={s.pickingMode}
          >
            {s.pickingMode ? '选点中，点击地图落点' : '＋ 在地图上加点'}
          </button>
        )}

        {s.origins.length === 0 && (
          <div className="empty-card">
            <span className="empty-pin" aria-hidden="true">＋</span>
            <div><strong>添加第一个地点</strong><p>搜索地点，或直接点击地图。</p></div>
          </div>
        )}

        <div className="origin-list">
          {s.origins.map((origin, index) => {
            const code = originCode(index)
            const thresholds = s.bandMode === 'paired' ? s.globalThresholds : origin.thresholds
            const cardStyle = {
              '--origin-color': origin.color,
              '--origin-tint': colorWithAlpha(origin.color, 0.065),
            } as CSSProperties

            return (
              <article
                className={origin.visible ? 'origin-card' : 'origin-card inactive'}
                key={origin.id}
                style={cardStyle}
              >
                <header className="origin-header">
                  <span
                    className="origin-badge"
                    style={{ backgroundColor: origin.color, color: contrastText(origin.color) }}
                    aria-label={`地点 ${code}`}
                  >
                    {code}
                  </span>
                  <label className="origin-name">
                    <span>地点 {code}</span>
                    <input
                      className="label-input"
                      value={origin.label}
                      aria-label={`地点 ${code} 名称`}
                      onChange={(event) => s.updateOrigin(origin.id, { label: event.target.value })}
                    />
                  </label>
                  <button
                    className="icon"
                    title={`删除 ${origin.label}`}
                    aria-label={`删除 ${origin.label}`}
                    onClick={() => s.removeOrigin(origin.id)}
                  >
                    ×
                  </button>
                </header>

                <div className="origin-toolbar">
                  <label className="participation">
                    <input
                      type="checkbox"
                      checked={origin.visible}
                      onChange={(event) => s.updateOrigin(origin.id, { visible: event.target.checked })}
                    />
                    <span className="participation-track" aria-hidden="true"><i /></span>
                    <span>{origin.visible ? '参与运算' : '已从运算排除'}</span>
                  </label>
                </div>

                <label className="field">
                  <span>出行方式</span>
                  <select
                    value={origin.mode}
                    onChange={(event) => s.setMode(origin.id, event.target.value as Mode)}
                  >
                    {(Object.keys(MODE_LABEL) as Mode[]).map((mode) => (
                      <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>
                    ))}
                  </select>
                </label>

                {s.bandMode === 'custom' && (
                  <div className="custom-time">
                    <span className="field-label">此地点的时间</span>
                    <div className="chips compact">
                      {[15, 30, 45, 60].map((minutes) => (
                        <button
                          key={minutes}
                          className={origin.thresholds.includes(minutes) ? 'chip on' : 'chip'}
                          onClick={() => s.updateOrigin(origin.id, { thresholds: [minutes] })}
                          aria-pressed={origin.thresholds.includes(minutes)}
                        >
                          {minutes}
                        </button>
                      ))}
                    </div>
                    <div className="slider-row">
                      <MinuteSlider
                        value={origin.thresholds[0] ?? 30}
                        onCommit={(value) => s.updateOrigin(origin.id, { thresholds: [value] })}
                      />
                    </div>
                  </div>
                )}

                <div className="layer-key">
                  <div className="layer-key-heading">
                    <span>地图颜色</span>
                    <small>越近越浓，越远越淡</small>
                  </div>
                  {thresholds.length > 0 ? (
                    <div className="band-swatches">
                      {[...thresholds].sort((a, b) => a - b).map((minutes) => {
                        const opacity = originBandOpacity(thresholds, minutes)
                        return (
                          <span
                            className="band-swatch"
                            key={minutes}
                            style={{
                              backgroundColor: colorWithAlpha(origin.color, opacity),
                              borderColor: colorWithAlpha(origin.color, Math.min(opacity + 0.28, 0.72)),
                            }}
                            title={`${minutes} 分钟 · ${Math.round(opacity * 100)}% 不透明度`}
                          >
                            <i style={{ backgroundColor: origin.color }} />
                            <b>{minutes}</b><small>分</small>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="no-bands">尚未选择时间档位</span>
                  )}
                </div>

                <div className="cell-status" aria-live="polite">
                  {thresholds.map((minutes) => {
                    const status = s.cells.get(cellKey(origin.id, minutes))
                    if (status === 'error') {
                      return (
                        <button key={minutes} className="retry" onClick={() => void s.retryCell(origin.id, minutes)}>
                          {minutes} 分钟失败，重试
                        </button>
                      )
                    }
                    if (status === 'empty') {
                      return <span key={minutes} className="tag muted">{minutes} 分钟：周边无可达路网</span>
                    }
                    if (status === 'loading') {
                      return <span key={minutes} className="tag loading">{minutes} 分钟：计算中</span>
                    }
                    return null
                  })}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="pane controls">
        <div className="section-heading">
          <h2>分析设定</h2>
          <span>{visibleIds.length >= 2 ? `${visibleIds.length} 点运算` : '单点范围'}</span>
        </div>

        {visibleIds.length >= 2 && (
          <div className="control-group">
            <span className="field-label">集合运算</span>
            <div className="chips segmented">
              {(Object.keys(OP_LABEL) as SetOp[]).map((op) => (
                <button
                  key={op}
                  className={s.op === op ? 'chip on' : 'chip'}
                  onClick={() => s.setOp(op)}
                  aria-pressed={s.op === op}
                >
                  {OP_LABEL[op]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="control-group">
          <span className="field-label">时间方式</span>
          <div className="chips segmented">
            <button
              className={s.bandMode === 'paired' ? 'chip on' : 'chip'}
              onClick={() => s.setBandMode('paired')}
              aria-pressed={s.bandMode === 'paired'}
            >
              同档配对
            </button>
            <button
              className={s.bandMode === 'custom' ? 'chip on' : 'chip'}
              onClick={() => s.setBandMode('custom')}
              aria-pressed={s.bandMode === 'custom'}
            >
              每点自定
            </button>
          </div>
        </div>

        {s.bandMode === 'paired' && (
          <div className="control-group time-control">
            <span className="field-label">共享时间档位</span>
            <div className="chips">
              {[15, 30, 45, MAX_MINUTES].map((minutes) => (
                <button
                  key={minutes}
                  className={s.globalThresholds.includes(minutes) ? 'chip on' : 'chip'}
                  onClick={() => s.setGlobalThresholds(
                    s.globalThresholds.includes(minutes)
                      ? s.globalThresholds.filter((value) => value !== minutes)
                      : [...s.globalThresholds, minutes].sort((a, b) => a - b),
                  )}
                  aria-pressed={s.globalThresholds.includes(minutes)}
                >
                  {minutes} 分
                </button>
              ))}
            </div>
            <div className="slider-row">
              <button
                className={s.globalThresholds.includes(s.customMinutes) ? 'chip on' : 'chip'}
                onClick={() => s.setGlobalThresholds(
                  s.globalThresholds.includes(s.customMinutes)
                    ? s.globalThresholds.filter((value) => value !== s.customMinutes)
                    : [...s.globalThresholds, s.customMinutes].sort((a, b) => a - b),
                )}
                aria-pressed={s.globalThresholds.includes(s.customMinutes)}
              >
                自定义
              </button>
              <MinuteSlider value={s.customMinutes} onCommit={s.setCustomMinutes} />
            </div>
          </div>
        )}

        {s.op === 'difference' && visibleIds.length >= 2 && (
          <label className="field difference-base">
            <span>差集基准点</span>
            <select value={s.baseOriginId ?? ''} onChange={(event) => s.setBaseOrigin(event.target.value || null)}>
              <option value="">请选择</option>
              {s.origins.map((origin, index) => (
                <option key={origin.id} value={origin.id}>{originCode(index)} · {origin.label}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="pane results">
        <div className="section-heading result-heading">
          <h2>{visibleIds.length === 1 ? '可达范围' : '运算结果'}</h2>
          {visibleIds.length >= 2 && (
            <span className="composite-key"><i style={{ backgroundColor: RESULT_COLOR }} /> 紫色轮廓</span>
          )}
        </div>

        {visibleIds.length === 0 && <p className="hint">添加地点后显示可达范围</p>}
        {visibleIds.length > 0 && results.length === 0 && <p className="hint">选择至少一个时间档位</p>}

        {visibleIds.length >= 1 && results.map(({ minutes, result }) => {
          const displayColor = visibleIds.length === 1 ? visible[0].color : RESULT_COLOR
          const opacity = visibleIds.length === 1
            ? originBandOpacity(bands, minutes)
            : resultBandOpacity(bands, minutes)
          return (
            <div className="result-row" key={minutes}>
              <span
                className="result-swatch"
                style={{ backgroundColor: colorWithAlpha(displayColor, opacity), borderColor: displayColor }}
                aria-hidden="true"
              />
              <div className="result-time">
                <b>{minutes} 分钟</b>
                <small>{Math.round(opacity * 100)}% 不透明度</small>
              </div>
              {result.kind === 'ok' && <strong className="ok">{formatArea(result.areaSqM)}</strong>}
              {result.kind === 'empty' && <span className="muted">{EMPTY_TEXT[s.op]}</span>}
              {result.kind === 'loading' && <span className="muted">计算中</span>}
              {result.kind === 'unavailable' && (
                <span className="warn">数据不全（缺 {result.missing.map(nameOf).join('、') || '基准点'}）</span>
              )}
            </div>
          )
        })}

        {exportable.length > 0 && (
          <button className="export" onClick={() => downloadGeoJSON(exportable)}>
            导出 GeoJSON <span aria-hidden="true">↗</span>
          </button>
        )}
      </section>
    </aside>
  )
}
