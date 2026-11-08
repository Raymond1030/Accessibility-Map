import type { CSSProperties } from 'react'
import type { TransitLeg } from '../commute/types'
import { legLabel, transitModeLabel } from '../commute/transit'

export function TransitItinerary({ legs, onShowMap }: { legs: TransitLeg[]; onShowMap: () => void }) {
  const rides = legs.filter(leg => leg.mode !== 'WALK')
  return <div className="transit-itinerary">
    <div className="transit-heading"><strong>乘车线路</strong><button onClick={onShowMap}>查看地图</button></div>
    <div className="transit-chain" aria-label="乘车顺序">
      {(rides.length ? rides : legs).map((leg, index) => <span key={index} className="transit-chain-item">
        {index > 0 && <span aria-hidden="true">→</span>}
        <span className="transit-line-badge" style={{ '--leg-color': leg.color } as CSSProperties}>{legLabel(leg)}</span>
      </span>)}
    </div>
    <ol className="transit-legs">{legs.map((leg, index) => <li key={index} style={{ '--leg-color': leg.color } as CSSProperties} className={leg.mode === 'WALK' ? 'walk-leg' : ''}>
      <span className="transit-leg-kind">{transitModeLabel(leg.mode)}</span>
      <div className="transit-leg-copy">
        {leg.mode === 'WALK' ? <strong>步行接驳{leg.meters !== undefined ? ` · ${Math.round(leg.meters)} 米` : ''}</strong>
          : <strong>{leg.lines.length ? leg.lines.join(' / ') : '线路名称未提供'}</strong>}
        {leg.mode !== 'WALK' && <p>{leg.from ?? '上车站未提供'} → {leg.to ?? '下车站未提供'}</p>}
        {leg.lines.length > 1 && <small>同一段可选线路，选择其中一条乘坐</small>}
        {leg.mode === 'WALK' && leg.instruction && <p>{leg.instruction}</p>}
        <small>{[leg.viaStops !== undefined ? `中途经过 ${leg.viaStops} 站` : '', leg.seconds !== undefined ? `约 ${Math.ceil(leg.seconds / 60)} 分钟` : ''].filter(Boolean).join(' · ')}</small>
        {leg.path.length < 2 && <small>此段暂无地图轨迹</small>}
      </div>
    </li>)}</ol>
    <p className="commute-note">实线为乘车路段，灰色虚线为步行；深圳地铁采用本地线路色，其余线路使用区分色。</p>
  </div>
}
