import { WelcomeMap } from './WelcomeMap'
import './Welcome.css'

import type { Scene } from '../state/navigation'

export function Welcome({ onEnter }: { onEnter: (scene: Scene) => void }) {
  return (
    <main className="welcome">
      <header className="welcome-header">
        <a className="welcome-brand" href="#welcome-title">可达性地图<span className="brand-caption">城市生活，按时间丈量</span></a>
        <button className="welcome-skip" onClick={() => onEnter('isochrone')}>直接进入地图 <span aria-hidden="true">↗</span></button>
      </header>
      <div className="welcome-main">
        <section className="welcome-copy">
          <p className="welcome-eyebrow">城市生活观察 / THE EVERYDAY ATLAS</p>
          <h1 id="welcome-title" tabIndex={-1}>生活的半径，<br /><span className="title-second">不止是</span><em>公里。</em></h1>
          <p className="welcome-subtitle">A little closer to everyday life.</p>
          <p className="welcome-description">半小时，能走到哪里？<br />从家到公司，从你这里到朋友那里，<br />把路上的时间，变成地图上看得见的范围。</p>
          <div className="welcome-actions">
            <button className="welcome-primary" onClick={() => onEnter('explore')}>探索我的生活圈 <span aria-hidden="true">↗</span></button>
            <button className="welcome-secondary" onClick={() => onEnter('commute')}>找一个通勤合适的家 <span aria-hidden="true">→</span></button>
          </div>
          <p className="welcome-footnote">选地点 · 设时间 · 看见可达范围</p>
        </section>
        <WelcomeMap />
      </div>
      <footer className="welcome-footer">
        <div><span>01</span><p><strong>从日常出发</strong><small>标记家、公司或常去的地点</small></p></div>
        <div><span>02</span><p><strong>用时间衡量</strong><small>选择出行方式和可接受的时长</small></p></div>
        <div><span>03</span><p><strong>找到交集</strong><small>比较生活圈，寻找合适的落脚点</small></p></div>

      </footer>
      <div className="welcome-colophon"><span>可达性地图 · 城市与日常</span><em>少一点奔波，多一点生活。</em></div>
    </main>
  )
}
