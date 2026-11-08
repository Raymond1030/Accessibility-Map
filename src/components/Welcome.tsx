import { useRef, useState } from 'react'
import { WelcomeMap } from './WelcomeMap'
import { WelcomeGuide } from './WelcomeGuide'
import { useReveal } from '../ui/useReveal'
import { usePauseOffscreen } from '../ui/usePauseOffscreen'
import type { Scene } from '../state/navigation'
import { SceneIcon } from './SceneIcon'
import './Welcome.css'

// 这些区域里有循环动画；滚出屏幕时暂停，回到视口附近再继续。
const LOOPING_SECTIONS = '.hero-stage, .welcome-real-figure, .steps, .use-cases, .welcome-cta'

const JOURNEYS: { scene: Scene; label: string; prompt: string; detail: string; action: string }[] = [
  { scene: 'explore', label: '探索生活圈', prompt: '想知道，家附近还有哪些值得去的地方。', detail: '公园、咖啡、书店……发现时间范围内的日常。', action: '探索我的生活圈' },
  { scene: 'commute', label: '找通勤住处', prompt: '想住得喜欢，也想把每天的通勤缩短一点。', detail: '标记工作地，看看通勤范围，再比较心仪的住处。', action: '寻找合适的住处' },
  { scene: 'isochrone', label: '约个见面点', prompt: '你从这里出发，TA 从那里来，在哪见面刚好？', detail: '标记彼此的位置，找一片大家都方便到达的区域。', action: '寻找共同的半径' },
]

/** 首屏插画：你和 TA 各自的时间圈在城市里相遇。纯装饰，文字信息都在标题和卡片里。 */
function HeroIllustration() {
  return <svg className="hero-art" viewBox="0 0 960 400" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id="hero-ta-range"><circle cx="588" cy="232" r="146" /></clipPath>
    </defs>
    <ellipse className="hero-ground" cx="480" cy="300" rx="470" ry="130" />
    <ellipse className="hero-ground-inner" cx="480" cy="296" rx="380" ry="96" />
    <path className="hero-river" d="M60 330 C220 280 300 360 470 330 S760 290 900 330" />
    <g className="hero-blocks">
      <rect x="250" y="150" width="62" height="42" rx="10" /><rect x="660" y="140" width="70" height="46" rx="10" />
      <rect x="300" y="262" width="54" height="36" rx="9" /><rect x="610" y="278" width="58" height="36" rx="9" />
      <rect x="430" y="300" width="96" height="30" rx="9" />
    </g>
    <g className="hero-roads"><path d="M150 210 C330 180 620 190 820 214" /><path d="M470 110 C460 200 480 280 500 370" /></g>

    <g className="hero-ring hero-ring-you"><circle cx="372" cy="228" r="150" /></g>
    <g className="hero-ring hero-ring-ta"><circle cx="588" cy="232" r="146" /></g>
    <circle className="hero-lens" cx="372" cy="228" r="150" clipPath="url(#hero-ta-range)" />

    <path className="hero-route hero-route-you" d="M340 236 C390 206 440 204 480 216" />
    <path className="hero-route hero-route-ta" d="M620 240 C570 206 520 204 480 216" />

    <g className="hero-chip hero-chip-you"><rect x="212" y="98" width="88" height="30" rx="15" /><text x="256" y="118">30 分钟</text></g>
    <g className="hero-chip hero-chip-ta"><rect x="660" y="98" width="88" height="30" rx="15" /><text x="704" y="118">30 分钟</text></g>

    <g className="hero-pin hero-pin-you"><circle cx="316" cy="240" r="24" /><text x="316" y="246">你</text></g>
    <g className="hero-pin hero-pin-ta"><circle cx="644" cy="244" r="24" /><text x="644" y="250">TA</text></g>

    <g className="hero-meet">
      <circle className="hero-meet-dot" cx="480" cy="214" r="9" />
      <g className="hero-bubble"><rect x="420" y="146" width="120" height="40" rx="20" /><path d="M472 185 l8 10 8-10z" /><text x="480" y="172">在这见面</text></g>
    </g>

    <g transform="translate(120 132)"><g className="hero-sticker hero-sticker-1"><circle r="26" /><path d="M-10 -4h16v9a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z M6 -1h3a3 3 0 0 1 0 6h-3 M-5 -12v3 M0 -13v4" /></g></g>
    <g transform="translate(840 150)"><g className="hero-sticker hero-sticker-2"><circle r="26" /><path d="M0 -12a9 9 0 0 1 9 9 8 8 0 0 1-9 8 8 8 0 0 1-9-8 9 9 0 0 1 9-9z M0 5v9 M-4 14h8" /></g></g>
    <g transform="translate(170 330)"><g className="hero-sticker hero-sticker-3"><circle r="24" /><path d="M-10 -8c4-2 7-2 10 1 3-3 6-3 10-1v16c-4-2-7-2-10 1-3-3-6-3-10-1z M0 -7v16" /></g></g>
    <g transform="translate(800 330)"><g className="hero-sticker hero-sticker-4"><circle r="24" /><path d="M-9 -2 0 -10 9 -2 M-7 -3v11h14v-11 M-2 8v-5h4v5" /></g></g>
    <g transform="translate(480 60)"><g className="hero-sticker hero-sticker-5"><circle r="22" /><path d="M-8 -6h16l-1 14h-14z M-4 -6v-2a4 4 0 0 1 8 0v2" /></g></g>
  </svg>
}

export function Welcome({ onEnter }: { onEnter: (scene: Scene) => void }) {
  const [selectedScene, setSelectedScene] = useState<Scene>('explore')
  const journey = JOURNEYS.find(item => item.scene === selectedScene)!
  const rootRef = useRef<HTMLElement>(null)
  useReveal(rootRef)
  usePauseOffscreen(rootRef, LOOPING_SECTIONS)

  return (
    <main className="welcome" ref={rootRef}>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <header className="welcome-header">
          <a className="welcome-brand" href="#welcome-title" aria-label="生活半径首页">
            <span className="radius-symbol" aria-hidden="true"><i /><i /></span>
            <span>生活半径</span>
          </a>
          <nav className="welcome-nav" aria-label="首页导航">
            <button onClick={() => onEnter('commute')}>租房通勤</button>
            <button onClick={() => onEnter('isochrone')}>约个见面点</button>
            <button onClick={() => onEnter('explore')}>生活探索</button>
            <a href="#faq">常见问题</a>
          </nav>
          <button className="welcome-skip" onClick={() => onEnter('isochrone')}>打开地图<span className="welcome-arrow" aria-hidden="true">→</span></button>
        </header>

        <div className="hero-copy">
          <p className="hero-badge"><span aria-hidden="true" />用时间丈量城市</p>
          <h1 id="welcome-title" tabIndex={-1}>下一站，<br className="hero-break" />离生活<em>近一点<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M4 14 C50 4 120 4 196 12" /></svg></em></h1>
          <p className="hero-sub">少一点奔波，多一点喜欢的日常。<br />找住处、约见面、逛附近，都从你愿意花在路上的时间开始。</p>
        </div>

        <div className="hero-stage">
          <HeroIllustration />
        </div>

        <div className="journey-card" data-scene={selectedScene}>
          <div className="journey-top">
            <span className="journey-ask">你想先做什么？</span>
            <div className="journey-options" role="group" aria-label="你想从哪里开始">
              {JOURNEYS.map(item => <button key={item.scene} data-scene={item.scene} aria-pressed={selectedScene === item.scene} onClick={() => setSelectedScene(item.scene)}><SceneIcon scene={item.scene} />{item.label}</button>)}
            </div>
          </div>
          {/* The live region stays mounted; only its keyed content re-mounts, so the swap animation replays on every scene change. */}
          <div className="journey-copy" aria-live="polite" aria-atomic="true">
            <div key={selectedScene} className="journey-copy-inner">
              <p>{journey.prompt}</p>
              <span>{journey.detail}</span>
            </div>
          </div>
          <div className="journey-bottom">
            <span className="journey-hint">无需注册，打开就能用</span>
            <button className="welcome-primary" onClick={() => onEnter(selectedScene)}><span key={selectedScene} className="welcome-primary-label">{journey.action}</span><span className="welcome-arrow" aria-hidden="true">→</span></button>
          </div>
        </div>
        <a className="welcome-story-link" href="#map-story">看看真实地图演示<span className="welcome-story-arrow" aria-hidden="true">↓</span></a>
      </section>

      <section className="welcome-section story-section" aria-labelledby="story-title">
        <div className="section-head" data-reveal>
          <span className="section-eyebrow">真实地图演示</span>
          <h2 id="story-title">两个人各花 30 分钟，能在哪见面？</h2>
          <p>用真实的地铁和步行数据，一步步看两个人的生活圈怎样相遇。</p>
        </div>
        <WelcomeMap />
      </section>

      <WelcomeGuide onEnter={onEnter} />

      <footer className="welcome-footer">
        <span className="welcome-footer-brand"><span className="radius-symbol" aria-hidden="true"><i /><i /></span>生活半径</span>
        <span>少一点奔波，多一点生活。</span>
        <span className="welcome-footer-meta">地图数据 © Mapbox © OpenStreetMap · 地点与路线 © 高德</span>
      </footer>
    </main>
  )
}
