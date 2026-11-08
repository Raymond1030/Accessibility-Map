import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Welcome } from './components/Welcome'
import { Sidebar } from './components/Sidebar'
import { MapView } from './components/MapView'
import { useStore } from './state/store'
import { useNavigation, type Scene } from './state/navigation'
import { CommutePanel } from './components/CommutePanel'
import { ExplorePanel } from './components/ExplorePanel'
import './App.css'

type IndicatorBox = { x: number; y: number; w: number; h: number }

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return sessionStorage.getItem('accessibility-map-welcome') !== 'seen' } catch { return true }
  })
  const navigationRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null)
  const previousWelcome = useRef(showWelcome)
  useEffect(() => {
    if (previousWelcome.current && !showWelcome) {
      window.scrollTo(0, 0)
      navigationRef.current?.focus({ preventScroll: true })
    }
    if (!previousWelcome.current && showWelcome) {
      window.scrollTo(0, 0)
      document.getElementById('welcome-title')?.focus({ preventScroll: true })
    }
    previousWelcome.current = showWelcome
  }, [showWelcome])
  const enter = (nextScene: Scene) => {
    useNavigation.getState().setScene(nextScene)
    useStore.getState().setDrawerOpen(true)
    try { sessionStorage.setItem('accessibility-map-welcome', 'seen') } catch { /* Storage may be disabled. */ }
    setShowWelcome(false)
  }
  const fatalError = useStore((s) => s.fatalError)
  const scene = useNavigation(s => s.scene)

  // 选中底色是一个独立色块，量出当前场景按钮的位置后滑过去；字体加载或换行导致按钮尺寸变化时重新测量。
  useLayoutEffect(() => {
    const nav = navRef.current
    if (showWelcome || !nav) { setIndicator(null); return }
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[data-scene-tab][aria-pressed="true"]')
      const next = active ? { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight } : null
      setIndicator(prev => prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    nav.querySelectorAll('[data-scene-tab]').forEach(tab => observer.observe(tab))
    return () => observer.disconnect()
  }, [scene, showWelcome])

  if (showWelcome) return <Welcome onEnter={enter} />

  const goHome = () => setShowWelcome(true)
  const brand = <><span className="radius-symbol" aria-hidden="true"><i /><i /></span><strong>生活半径</strong></>

  // 地图铺满整个窗口；场景切换栏和控制面板都悬浮在地图上（手机端面板是底部抽屉）。
  return (
    <div className="app" data-scene={scene}>
      <div className="app-body">
        <nav ref={navRef} className={indicator ? 'scene-switch has-indicator' : 'scene-switch'} aria-label="使用场景">
          {indicator && <span className="scene-indicator" aria-hidden="true" style={{ width: indicator.w, height: indicator.h, transform: `translate(${indicator.x}px, ${indicator.y}px)` }} />}
          <button className="app-brand nav-brand" onClick={goHome} aria-label="生活半径，返回介绍首页">{brand}</button>
          <button ref={navigationRef} data-scene-tab="isochrone" aria-pressed={scene === 'isochrone'} onClick={() => useNavigation.getState().setScene('isochrone')}>多点见面</button>
          <button data-scene-tab="commute" aria-pressed={scene === 'commute'} onClick={() => useNavigation.getState().setScene('commute')}>租房通勤</button>
          <button data-scene-tab="explore" aria-pressed={scene === 'explore'} onClick={() => useNavigation.getState().setScene('explore')}>生活探索</button>
        </nav>
        <div className="workspace-panel">
          <header className="panel-head">
            <button className="app-brand" onClick={goHome} aria-label="生活半径，返回介绍首页">{brand}</button>
            <button className="intro-link" onClick={goHome}>使用介绍</button>
          </header>
          {scene === 'commute' ? <CommutePanel /> : scene === 'explore' ? <ExplorePanel /> : <Sidebar />}
        </div>
        <MapView />
        {fatalError && (
          <div className="fatal" role="alert">
            <b>配置问题：</b>{fatalError}
          </div>
        )}
      </div>
    </div>
  )
}
