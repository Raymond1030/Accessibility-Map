import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getMapboxToken } from '../mapbox/token'
import type { Scene } from '../state/navigation'
import './WelcomeGuide.css'

const USE_CASES: { scene: Scene; tag: string; title: string; description: string; example: string; action: string }[] = [
  { scene: 'commute', tag: '给准备搬家的你', title: '房租之外，也算算路上的时间。', description: '先看工作地周边的通勤范围，再把心仪住处放在一起，比较月租、路线与耗时。', example: '「这两个小区，哪个更适合每天上班？」', action: '比较我的通勤' },
  { scene: 'isochrone', tag: '给想见面的人', title: '选一个，对彼此都顺路的地方。', description: '把大家的起点和出行方式放上地图，找到各自时间范围的交集，见面不用再猜中间点。', example: '「我们都花半小时，能在哪里碰面？」', action: '找个见面地点' },
  { scene: 'explore', tag: '给想逛逛的今天', title: '熟悉的附近，还有新的日常。', description: '从家门口出发，看看公园、咖啡和书店的可达选择。拿不定主意时，还可以抽一份周末盲盒。', example: '「走路十五分钟，有哪些值得去的地方？」', action: '发现附近的生活' },
]

function GuideIcon({ kind }: { kind: 'place' | 'time' | 'area' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'place' ? <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></> : kind === 'time' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : <><circle cx="8" cy="12" r="6.5" /><circle cx="16" cy="12" r="6.5" /></>}
  </svg>
}

const CASE_MAPS = {
  commute: { center: [113.945, 22.541] as [number, number], zoom: 13.2, label: '深圳 · 南山科技园' },
  isochrone: { center: [113.929, 22.52] as [number, number], zoom: 12.1, label: '深圳 · 前海—后海' },
  explore: { center: [113.977, 22.523] as [number, number], zoom: 14, label: '深圳 · 深圳湾公园' },
}

function CaseDiagram({ scene }: { scene: Scene }) {
  const container = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const place = CASE_MAPS[scene]

  useEffect(() => {
    const element = container.current
    if (!element) return
    let map: mapboxgl.Map | undefined
    let resize: ResizeObserver | undefined
    let deadline: number | undefined
    let disposed = false
    setStatus('loading')
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || map) return
      observer.disconnect()
      try {
        const preview = new mapboxgl.Map({
          container: element, accessToken: getMapboxToken(),
          style: 'mapbox://styles/mapbox/streets-v12',
          center: place.center, zoom: place.zoom,
          interactive: false, attributionControl: false,
        })
        map = preview
        preview.addControl(new mapboxgl.AttributionControl({ compact: true }))
        preview.getCanvas().setAttribute('tabindex', '-1')
        preview.getCanvas().setAttribute('aria-label', `${place.label}真实街区地图`)
        deadline = window.setTimeout(() => { if (!disposed) setStatus('error') }, 25000)
        preview.on('load', () => {
          if (disposed) return
          window.clearTimeout(deadline)
          for (const layer of preview.getStyle().layers ?? []) {
            if (layer.type === 'symbol' && layer.layout?.['text-field']) {
              preview.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name_zh-Hans'], ['get', 'name_zh-Hant'], ['get', 'name']])
            }
          }
          setStatus('ready')
        })
        preview.on('error', event => {
          if (!disposed && /401|403|Unauthorized|Forbidden/i.test(event.error?.message ?? '')) {
            window.clearTimeout(deadline)
            setStatus('error')
          }
        })
        resize = new ResizeObserver(() => preview.resize())
        resize.observe(element)
      } catch { if (!disposed) setStatus('error') }
    }, { rootMargin: '200px' })
    observer.observe(element)
    return () => {
      disposed = true
      observer.disconnect()
      resize?.disconnect()
      window.clearTimeout(deadline)
      map?.remove()
    }
  }, [place, attempt])

  return <div className={`case-diagram case-diagram-${scene}`}>
    <div ref={container} className="case-map" />
    <span className="case-map-location">{place.label}</span>
    {status !== 'ready' && <div className="case-map-status" role="status">
      {status === 'loading' ? '正在加载真实地图…' : <>地图暂时无法加载<button onClick={() => setAttempt(value => value + 1)}>重新加载</button></>}
    </div>}
  </div>
}

export function WelcomeGuide({ onEnter }: { onEnter: (scene: Scene) => void }) {
  return <section className="welcome-discover" id="how-it-works" aria-labelledby="guide-title">
    <div className="guide-heading">
      <div><p className="guide-eyebrow">从一个地点，到一种生活 / HOW IT WORKS</p><h2 id="guide-title">把抽象的距离，<br />变成具体的日常。</h2></div>
      <p>地图上的远近，不一定是生活里的远近。<br />从你在意的地方出发，把愿意花在路上的时间，<br className="desktop-break" />换成看得见、能比较的选择。</p>
    </div>

    <ol className="guide-process">
      <li><span className="guide-icon"><GuideIcon kind="place" /></span><div><span className="guide-step-label">01 / 选地点</span><h3>先放下一个生活坐标</h3><p>搜索家、公司或朋友的位置，<br />也可以直接在地图上标记。</p></div><span className="guide-step-arrow" aria-hidden="true">→</span></li>
      <li><span className="guide-icon"><GuideIcon kind="time" /></span><div><span className="guide-step-label">02 / 设时间</span><h3>决定怎么走，愿意走多久</h3><p>选择出行方式和可接受的时长，<br />让范围贴近你的日常节奏。</p></div><span className="guide-step-arrow" aria-hidden="true">→</span></li>
      <li><span className="guide-icon"><GuideIcon kind="area" /></span><div><span className="guide-step-label">03 / 看结果</span><h3>把合适的选择留在地图上</h3><p>看可达范围、比较具体路线，<br />找到更适合生活的落脚点。</p></div></li>
    </ol>

    <div className="use-cases-heading"><h2>一个半径，三种打开方式。</h2><span>从你今天关心的事开始</span></div>
    <div className="use-cases">
      {USE_CASES.map(item => <article className={`use-case use-case-${item.scene}`} key={item.scene}>
        <CaseDiagram scene={item.scene} />
        <div className="use-case-copy"><span className="use-case-tag">{item.tag}</span><h3>{item.title}</h3><p>{item.description}</p><blockquote>{item.example}</blockquote><button onClick={() => onEnter(item.scene)}>{item.action}<span aria-hidden="true">↗</span></button></div>
      </article>)}
    </div>

    <div className="guide-questions"><div><p className="guide-eyebrow">开始之前</p><h2>你可能还想知道</h2></div><div className="guide-answers">
      <details><summary>范围和路线，应该怎么看？<span aria-hidden="true">+</span></summary><p>可达范围适合先筛选区域；选定具体住处或地点后，再查看路线与耗时。地图上的圈不是直线距离圆，实际出行仍会受路网、换乘和路况影响。</p></details>
      <details><summary>两个人的范围没有交集，怎么办？<span aria-hidden="true">+</span></summary><p>这表示当前条件下，还没有大家都能到达的共同区域。可以增加一点时间、换一种出行方式，或调整起点再试试。</p></details>
      <details><summary>需要注册吗？选过的地点会保存吗？<span aria-hidden="true">+</span></summary><p>不用注册，可以直接开始。候选住处、探索收藏和抽取记录保留在当前页面中，刷新后会清空；多点等时圈的结果可以导出为 GeoJSON。</p></details>
    </div></div>
  </section>
}
