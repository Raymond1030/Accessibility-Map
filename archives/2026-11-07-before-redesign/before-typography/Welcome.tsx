import { useState } from 'react'
import { WelcomeMap } from './WelcomeMap'
import { WelcomeGuide } from './WelcomeGuide'
import type { Scene } from '../state/navigation'
import './Welcome.css'

const JOURNEYS: { scene: Scene; label: string; prompt: string; detail: string; action: string }[] = [
  { scene: 'explore', label: '探索生活圈', prompt: '想知道，家附近还有哪些值得去的地方。', detail: '公园、咖啡、书店……发现时间范围内的日常。', action: '探索我的生活圈' },
  { scene: 'commute', label: '找通勤住处', prompt: '想住得喜欢，也想把每天的通勤缩短一点。', detail: '标记工作地，看看通勤范围，再比较心仪的住处。', action: '寻找合适的住处' },
  { scene: 'isochrone', label: '约个见面点', prompt: '你从这里出发，TA 从那里来，在哪见面刚好？', detail: '标记彼此的位置，找一片大家都方便到达的区域。', action: '寻找共同的半径' },
]

function JourneyIcon({ scene }: { scene: Scene }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {scene === 'explore' ? <><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2z" /></> : scene === 'commute' ? <><path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7" /></> : <><circle cx="8.5" cy="12" r="6.5" /><circle cx="15.5" cy="12" r="6.5" /></>}
  </svg>
}

export function Welcome({ onEnter }: { onEnter: (scene: Scene) => void }) {
  const [selectedScene, setSelectedScene] = useState<Scene>('explore')
  const journey = JOURNEYS.find(item => item.scene === selectedScene)!

  return (
    <main className="welcome">
      <header className="welcome-header">
        <a className="welcome-brand" href="#welcome-title" aria-label="生活半径首页">
          <span className="radius-symbol" aria-hidden="true"><i /><i /></span>
          <span>生活半径<small>life, within reach</small></span>
        </a>
        <nav className="welcome-nav" aria-label="首页导航">
          <button onClick={() => onEnter('explore')}>生活探索</button>
          <button onClick={() => onEnter('commute')}>租房通勤</button>
          <a href="#how-it-works">如何使用</a>
        </nav>
        <button className="welcome-skip" onClick={() => onEnter('isochrone')}>打开地图 <span aria-hidden="true">↗</span></button>
      </header>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="welcome-eyebrow"><span aria-hidden="true" /> 城市很大，生活可以近一点</p>
          <h1 id="welcome-title" tabIndex={-1}>下一站，<span>离生活近一点。</span></h1>
          <p className="welcome-description">少一点奔波，多一点喜欢的日常。<br />用时间丈量城市，找到适合你的生活圈。</p>

          <div className="journey-card">
            <div className="journey-options" role="group" aria-label="你想从哪里开始">
              {JOURNEYS.map(item => <button key={item.scene} aria-pressed={selectedScene === item.scene} onClick={() => setSelectedScene(item.scene)}><JourneyIcon scene={item.scene} />{item.label}</button>)}
            </div>
            <div className="journey-copy" aria-live="polite" aria-atomic="true">
              <p>{journey.prompt}</p>
              <span>{journey.detail}</span>
            </div>
            <div className="journey-bottom">
              <span className="journey-hint"><span aria-hidden="true">⌖</span> 从一个地点开始</span>
              <button className="welcome-primary" onClick={() => onEnter(selectedScene)}>{journey.action}<span aria-hidden="true">↗</span></button>
            </div>
          </div>
          <p className="welcome-footnote">无需注册 <span>·</span> 用你愿意花在路上的时间，重新认识城市</p>
          <a className="welcome-story-link" href="#map-story">观看地图动画 <span aria-hidden="true">↓</span></a>
        </div>

        <WelcomeMap />
      </section>

      <WelcomeGuide onEnter={onEnter} />
      <footer className="welcome-colophon"><span>生活半径 <span aria-hidden="true">/</span> THE EVERYDAY ATLAS</span><span>少一点奔波，多一点生活。<span aria-hidden="true"> ↗</span></span></footer>
    </main>
  )
}
