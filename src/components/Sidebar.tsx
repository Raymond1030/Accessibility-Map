import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { SearchBox } from './SearchBox'
import { ResultsPanel, resultSummary, type ResultItem } from './ResultsPanel'
import { useStore } from '../state/store'
import { computeBand, computeCustomBand } from '../state/compute'
import { cellKey, MAX_MINUTES, MODE_LABEL, type MarkerIcon, type Mode, type SetOp } from '../types'
import { useIsMobile } from '../ui/responsive'
import { colorWithAlpha, contrastText, originCode } from '../ui/mapStyle'
import { MARKER_ICON_OPTIONS, MarkerIconGlyph, resolveMarkerIcon } from '../ui/markerIcons'
import accessibilityMapIcon from '../assets/accessibility-map-icon.png'
import './Sidebar.css'

const OP_LABEL: Record<SetOp, string> = {
  intersect: '交集',
  union: '并集',
  difference: '差集',
}

const TIME_PRESETS = [15, 30, 45, MAX_MINUTES]

function ModeIcon({ mode }: { mode: Mode }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const

  if (mode === 'walking') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
        <circle cx="13" cy="4.5" r="2" />
        <path d="m11.5 8-2.2 4.1 3.5 2.2 2 6.2M11.7 8.5l3.4 2.7 2.8.5M9.3 12.1l-3 3.2M12.8 14.3l-3.4 6.2" />
      </svg>
    )
  }

  if (mode === 'cycling') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
        <circle cx="6" cy="17" r="3.5" /><circle cx="18" cy="17" r="3.5" />
        <path d="m6 17 4-7 3 7H6Zm4-7h4M13 17l3-9h2M15.5 10H19" />
      </svg>
    )
  }

  if (mode === 'transit-walking') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
        <path d="M5 16.5V7.7C5 5.4 6.6 4 9 4h6c2.4 0 4 1.4 4 3.7v8.8" />
        <path d="M5 9h14M7.5 13h.1m8.9 0h.1M7 16.5h10M8 16.5v2.8m8-2.8v2.8" />
      </svg>
    )
  }

  if (mode === 'subway-walking' || mode === 'metro-cycling') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
        <path d="M7 17.5c-1.1 0-2-.9-2-2V7.8C5 5.3 7.1 4 12 4s7 1.3 7 3.8v7.7c0 1.1-.9 2-2 2H7Z" />
        <path d="M5 9.5h14M8.2 13h.1m7.4 0h.1M8 17.5l-2 2.5m10-2.5 2 2.5" />
        {mode === 'metro-cycling' && <path d="M10 20h4" />}
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
      {mode === 'driving-traffic' && <path d="M6.5 5.5h1m3.5-2h1m3.5 2h1" />}
      <path d="m5.2 10 1.5-3h10.6l1.5 3 1.2 1.5V17H4v-5.5L5.2 10Z" />
      <path d="M4 12h16M7 15h.1m9.9 0h.1M6 17v2m12-2v2" />
    </svg>
  )
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
  const isMobile = useIsMobile()
  const [expandedOriginId, setExpandedOriginId] = useState<string | null>(null)

  const visible = useMemo(() => s.origins.filter((origin) => origin.visible), [s.origins])
  const visibleIds = useMemo(() => visible.map((origin) => origin.id), [visible])
  const bands = useMemo(
    () => (s.bandMode === 'paired' ? s.globalThresholds : [visible[0]?.thresholds[0] ?? 0]),
    [s.bandMode, s.globalThresholds, visible],
  )
  const results = useMemo<ResultItem[]>(() => {
    if (s.bandMode === 'custom') {
      const minutesByOrigin = new Map(visible.flatMap((origin) => {
        const minutes = origin.thresholds[0]
        return minutes === undefined ? [] : [[origin.id, minutes] as const]
      }))
      return [{
        minutes: bands[0] ?? 0,
        label: '分别设置',
        minutesByOrigin: Object.fromEntries(minutesByOrigin),
        result: computeCustomBand({
          op: s.op,
          originIds: visibleIds,
          minutesByOrigin,
          cells: s.cells,
          geoms: s.geoms,
          baseOriginId: s.baseOriginId,
        }),
      }]
    }

    return bands.map((minutes) => ({
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
  }, [bands, s.bandMode, s.baseOriginId, s.cells, s.geoms, s.op, visible, visibleIds])
  const summary = resultSummary(visibleIds.length, results, s.op)

  return (
    <aside className={s.drawerOpen ? 'sidebar' : 'sidebar collapsed'}>
      <button className="drawer-handle" onClick={s.toggleDrawer} aria-expanded={s.drawerOpen}>
        <span className="grip" />
        <span className="summary">{summary}</span>
        <span className="caret" aria-hidden="true">{s.drawerOpen ? '▾' : '▴'}</span>
      </button>

      <section className="pane origins">
        <div className="sidebar-intro">
          <img className="product-signature" src={accessibilityMapIcon} alt="" aria-hidden="true" />
          <h1>可达性地图</h1>
        </div>

        <div className="section-heading">
          <h2>地点</h2>
          <span>{visible.length} / {s.origins.length} 已参与</span>
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
            const markerIcon = resolveMarkerIcon(origin.markerIcon)
            const expanded = expandedOriginId === origin.id
            const thresholds = s.bandMode === 'paired' ? s.globalThresholds : origin.thresholds.slice(0, 1)
            const customMinutes = origin.thresholds[0] ?? 30
            const loadingCount = thresholds.filter(
              (minutes) => s.cells.get(cellKey(origin.id, minutes)) === 'loading',
            ).length
            const errorMinutes = thresholds.filter(
              (minutes) => s.cells.get(cellKey(origin.id, minutes)) === 'error',
            )
            const emptyMinutes = thresholds.filter(
              (minutes) => s.cells.get(cellKey(origin.id, minutes)) === 'empty',
            )
            const cardStyle = {
              '--origin-color': origin.color,
              '--origin-tint': colorWithAlpha(origin.color, 0.065),
            } as CSSProperties
            const meta = [
              MODE_LABEL[origin.mode],
              ...(s.bandMode === 'custom' ? [`${customMinutes} 分钟`] : []),
              ...(!origin.visible ? ['已排除'] : []),
            ].join(' · ')

            return (
              <article
                className={origin.visible ? 'origin-card' : 'origin-card inactive'}
                key={origin.id}
                style={cardStyle}
              >
                <button
                  className="origin-summary"
                  onClick={() => setExpandedOriginId(expanded ? null : origin.id)}
                  aria-expanded={expanded}
                  aria-controls={`origin-editor-${origin.id}`}
                >
                  <span
                    className="origin-badge"
                    style={{ backgroundColor: origin.color, color: contrastText(origin.color) }}
                    aria-hidden="true"
                  >
                    <MarkerIconGlyph icon={markerIcon} />
                    <span className="origin-badge-code">{code}</span>
                  </span>
                  <span className="origin-summary-copy">
                    <strong>{origin.label}</strong>
                    <small><ModeIcon mode={origin.mode} /><span>{meta}</span></small>
                  </span>
                  <span className="origin-caret" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                </button>

                {expanded && (
                  <div className="origin-editor" id={`origin-editor-${origin.id}`}>
                    <label className="editor-field">
                      <span>地点名称</span>
                      <input
                        className="label-input"
                        value={origin.label}
                        aria-label={`地点 ${code} 名称`}
                        onChange={(event) => s.updateOrigin(origin.id, { label: event.target.value })}
                      />
                    </label>

                    <fieldset className="marker-picker">
                      <legend>地图标记</legend>
                      <div className="marker-options">
                        {MARKER_ICON_OPTIONS.map((option) => (
                          <button
                            type="button"
                            key={option.id}
                            className={markerIcon === option.id ? 'marker-option on' : 'marker-option'}
                            onClick={() => s.updateOrigin(origin.id, { markerIcon: option.id as MarkerIcon })}
                            aria-pressed={markerIcon === option.id}
                            aria-label={`地图标记：${option.label}`}
                          >
                            <MarkerIconGlyph icon={option.id} />
                            <span>{option.label}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <fieldset className="mode-picker">
                      <legend>出行方式</legend>
                      <div className="mode-options">
                        {(Object.keys(MODE_LABEL) as Mode[]).map((mode) => (
                          <button
                            type="button"
                            key={mode}
                            className={origin.mode === mode ? 'mode-option on' : 'mode-option'}
                            onClick={() => s.setMode(origin.id, mode)}
                            aria-pressed={origin.mode === mode}
                          >
                            <ModeIcon mode={mode} />
                            <span>{MODE_LABEL[mode]}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    {s.bandMode === 'custom' && (
                      <div className="origin-time-editor">
                        <span className="field-label">此地点的时间</span>
                        <div className="chips time-presets compact">
                          {TIME_PRESETS.map((minutes) => (
                            <button
                              key={minutes}
                              className={customMinutes === minutes ? 'chip on' : 'chip'}
                              onClick={() => s.updateOrigin(origin.id, { thresholds: [minutes] })}
                              aria-pressed={customMinutes === minutes}
                            >
                              {minutes} 分
                            </button>
                          ))}
                        </div>
                        <details className="time-disclosure">
                          <summary><span>自定义时间</span><b>{customMinutes} 分</b></summary>
                          <div className="slider-row">
                            <MinuteSlider
                              value={customMinutes}
                              onCommit={(value) => s.updateOrigin(origin.id, { thresholds: [value] })}
                            />
                          </div>
                        </details>
                      </div>
                    )}

                    {(s.origins.length >= 2 || !origin.visible) && (
                      <label className="participation">
                        <input
                          type="checkbox"
                          checked={origin.visible}
                          onChange={(event) => s.updateOrigin(origin.id, { visible: event.target.checked })}
                        />
                        <span className="participation-track" aria-hidden="true"><i /></span>
                        <span>{origin.visible ? '参与运算' : '已从运算排除'}</span>
                      </label>
                    )}

                    <button
                      className="remove-origin"
                      onClick={() => {
                        setExpandedOriginId(null)
                        s.removeOrigin(origin.id)
                      }}
                    >
                      删除地点
                    </button>
                  </div>
                )}

                {(loadingCount > 0 || errorMinutes.length > 0 || emptyMinutes.length > 0) && (
                  <div className="cell-status" aria-live="polite">
                    {loadingCount > 0 && (
                      <span className="tag loading">正在计算 {loadingCount} 个时间档</span>
                    )}
                    {emptyMinutes.map((minutes) => (
                      <span key={minutes} className="tag muted">{minutes} 分钟：周边无可达路网</span>
                    ))}
                    {errorMinutes.map((minutes) => (
                      <button
                        key={minutes}
                        className="retry"
                        onClick={() => void s.retryCell(origin.id, minutes)}
                      >
                        {minutes} 分钟失败，重试
                      </button>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <section className="pane controls">
        <div className="section-heading">
          <h2>{visibleIds.length >= 2 ? '分析与时间' : '时间'}</h2>
          <span>{visibleIds.length >= 2 ? `${visibleIds.length} 点运算` : '单点范围'}</span>
        </div>

        {visibleIds.length >= 2 && (
          <div className="control-group">
            <span className="field-label">运算方式</span>
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

        {visibleIds.length >= 2 && (
          <div className="control-group">
            <span className="field-label">时间设置</span>
            <div className="chips segmented">
              <button
                className={s.bandMode === 'paired' ? 'chip on' : 'chip'}
                onClick={() => s.setBandMode('paired')}
                aria-pressed={s.bandMode === 'paired'}
              >
                统一时间
              </button>
              <button
                className={s.bandMode === 'custom' ? 'chip on' : 'chip'}
                onClick={() => s.setBandMode('custom')}
                aria-pressed={s.bandMode === 'custom'}
              >
                分别设置
              </button>
            </div>
          </div>
        )}

        {s.bandMode === 'paired' && (
          <div className="control-group time-control">
            <span className="field-label">时间档位</span>
            <div className="chips time-presets">
              {TIME_PRESETS.map((minutes) => (
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
            <details className="time-disclosure">
              <summary>
                <span>自定义时间</span>
                <b>{s.customMinutes} 分</b>
              </summary>
              <div className="custom-time-controls">
                <button
                  className={s.globalThresholds.includes(s.customMinutes) ? 'custom-time-toggle on' : 'custom-time-toggle'}
                  onClick={() => s.setGlobalThresholds(
                    s.globalThresholds.includes(s.customMinutes)
                      ? s.globalThresholds.filter((value) => value !== s.customMinutes)
                      : [...s.globalThresholds, s.customMinutes].sort((a, b) => a - b),
                  )}
                  aria-pressed={s.globalThresholds.includes(s.customMinutes)}
                >
                  {s.globalThresholds.includes(s.customMinutes) ? '已使用此档' : '使用此档'}
                </button>
                <div className="slider-row">
                  <MinuteSlider value={s.customMinutes} onCommit={s.setCustomMinutes} />
                </div>
              </div>
            </details>
          </div>
        )}

        {s.bandMode === 'custom' && (
          <p className="inline-guidance">展开地点卡，分别设置每个地点的时间。</p>
        )}

        {s.op === 'difference' && visibleIds.length >= 2 && (
          <label className="editor-field difference-base">
            <span>差集基准点</span>
            <select value={s.baseOriginId ?? ''} onChange={(event) => s.setBaseOrigin(event.target.value || null)}>
              <option value="">请选择</option>
              {s.origins.map((origin, index) => (
                <option key={origin.id} value={origin.id}>{originCode(index)} · {origin.label}</option>
              ))}
            </select>
          </label>
        )}

        <details className="map-help">
          <summary>怎么看地图</summary>
          <p><span aria-hidden="true" />每个地点使用自己的颜色；同色越深，表示到达时间越短。</p>
        </details>
      </section>

      {isMobile && (
        <ResultsPanel
          variant="inline"
          allOrigins={s.origins}
          visibleOrigins={visible}
          bands={bands}
          results={results}
          op={s.op}
        />
      )}
    </aside>
  )
}
