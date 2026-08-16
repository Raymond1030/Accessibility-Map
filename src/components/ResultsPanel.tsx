import type { Origin, SetOp } from '../types'
import type { BandResult } from '../geometry/result'
import { formatArea } from '../geometry/result'
import { downloadGeoJSON, type ExportItem } from '../export'
import {
  RESULT_COLOR,
  colorWithAlpha,
  originBandOpacity,
  resultBandOpacity,
} from '../ui/mapStyle'
import './ResultsPanel.css'

const EMPTY_TEXT: Record<SetOp, string> = {
  intersect: '无共同可达区',
  union: '无可达区域',
  difference: '基准点范围已被完全覆盖',
}

export type ResultItem = {
  minutes: number
  label?: string
  minutesByOrigin?: Record<string, number>
  result: BandResult
}

function timeLabel(item: ResultItem): string {
  return item.label ?? `${item.minutes} 分钟`
}

export function resultSummary(
  visibleCount: number,
  results: ResultItem[],
  op: SetOp,
): string {
  if (visibleCount === 0) return '添加一个地点开始'
  const hit = results.find((item) => item.result.kind === 'ok')
  if (hit?.result.kind === 'ok') {
    return `${timeLabel(hit)} · ${formatArea(hit.result.areaSqM)}`
  }
  const first = results[0]
  if (!first) return '选择时间档位'
  if (first.result.kind === 'loading') return '正在计算可达范围'
  if (first.result.kind === 'empty') return `${timeLabel(first)} · ${EMPTY_TEXT[op]}`
  return '数据不全，无法计算'
}

type ResultsPanelProps = {
  variant: 'overlay' | 'inline'
  allOrigins: Origin[]
  visibleOrigins: Origin[]
  bands: number[]
  results: ResultItem[]
  op: SetOp
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

function ExportIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 1.75v7.5m0 0 2.75-2.75M8 9.25 5.25 6.5M2.25 10v3.25h11.5V10" />
    </svg>
  )
}

export function ResultsPanel({
  variant,
  allOrigins,
  visibleOrigins,
  bands,
  results,
  op,
  collapsed = false,
  onToggleCollapsed,
}: ResultsPanelProps) {
  const visibleCount = visibleOrigins.length
  const exportable: ExportItem[] = results.flatMap((item) => {
    if (item.result.kind !== 'ok') return []
    return [{
      ...(item.minutesByOrigin ? { minutesByOrigin: item.minutesByOrigin } : { minutes: item.minutes }),
      feature: item.result.geometry,
    }]
  })
  const summary = resultSummary(visibleCount, results, op)
  const title = visibleCount === 1 ? '可达范围' : '运算结果'
  const displayColor = visibleCount === 1 ? visibleOrigins[0].color : RESULT_COLOR
  const nameById = new Map(allOrigins.map((origin) => [origin.id, origin.label]))

  return (
    <section
      className={`results-panel ${variant}${collapsed ? ' is-collapsed' : ''}`}
      aria-label={title}
    >
      <header className="results-panel-header">
        <div className="results-panel-heading">
          <h2>{collapsed ? summary : title}</h2>
          {!collapsed && visibleCount >= 2 && (
            <span className="results-composite-key">
              <i style={{ backgroundColor: RESULT_COLOR }} />结果轮廓
            </span>
          )}
        </div>
        <div className="results-panel-actions">
          {!collapsed && exportable.length > 0 && (
            <button
              className="results-export"
              onClick={() => downloadGeoJSON(exportable)}
              aria-label="导出结果为 GeoJSON"
            >
              <ExportIcon />
              <span>导出</span>
            </button>
          )}
          {onToggleCollapsed && (
            <button
              className="results-collapse"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? '展开运算结果' : '收起运算结果'}
            >
              <span aria-hidden="true">{collapsed ? '▴' : '▾'}</span>
            </button>
          )}
        </div>
      </header>

      {!collapsed && (
        <div className="results-panel-body" aria-live="polite">
          {visibleCount === 0 && <p className="result-hint">添加地点后显示可达范围</p>}
          {visibleCount > 0 && results.length === 0 && (
            <p className="result-hint">选择至少一个时间档位</p>
          )}

          {visibleCount > 0 && results.map((item) => {
            const { minutes, result } = item
            const opacity = visibleCount === 1
              ? originBandOpacity(bands, minutes)
              : resultBandOpacity(bands, minutes)
            return (
              <div className="result-item" key={`${minutes}-${item.label ?? ''}`}>
                <span
                  className="result-item-swatch"
                  style={{
                    backgroundColor: colorWithAlpha(displayColor, opacity),
                    borderColor: displayColor,
                  }}
                  aria-hidden="true"
                />
                <b>{timeLabel(item)}</b>
                {result.kind === 'ok' && <strong>{formatArea(result.areaSqM)}</strong>}
                {result.kind === 'empty' && <span className="result-muted">{EMPTY_TEXT[op]}</span>}
                {result.kind === 'loading' && <span className="result-muted">计算中</span>}
                {result.kind === 'unavailable' && (
                  <span className="result-warning">
                    数据不全（缺 {result.missing.map((id) => nameById.get(id) ?? id).join('、') || '基准点'}）
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
