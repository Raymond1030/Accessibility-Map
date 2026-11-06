import { useEffect, useRef, useState } from 'react'
import { Welcome } from './components/Welcome'
import { Sidebar } from './components/Sidebar'
import { MapView } from './components/MapView'
import { useStore } from './state/store'
import { useNavigation, type Scene } from './state/navigation'
import { CommutePanel } from './components/CommutePanel'
import { ExplorePanel } from './components/ExplorePanel'
import './App.css'

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return sessionStorage.getItem('accessibility-map-welcome') !== 'seen' } catch { return true }
  })
  const navigationRef = useRef<HTMLButtonElement>(null)
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

  if (showWelcome) return <Welcome onEnter={enter} />

  return (
    <div className="app">
      <nav className="scene-switch" aria-label="使用场景">
        <button className="app-brand" onClick={() => setShowWelcome(true)} aria-label="可达性地图，返回介绍首页"><span aria-hidden="true">↗</span><strong>可达性地图</strong></button>
        <button ref={navigationRef} aria-pressed={scene === 'isochrone'} onClick={() => useNavigation.getState().setScene('isochrone')}>多点等时圈</button>
        <button aria-pressed={scene === 'commute'} onClick={() => useNavigation.getState().setScene('commute')}>租房通勤</button>
        <button aria-pressed={scene === 'explore'} onClick={() => useNavigation.getState().setScene('explore')}>生活探索</button>
      <button className="intro-link" onClick={() => setShowWelcome(true)}>使用介绍</button>
      </nav>
      {fatalError && (
        <div className="fatal">
          <b>配置问题：</b>{fatalError}
        </div>
      )}
      <div className="app-body">
        {scene === 'commute' ? <CommutePanel /> : scene === 'explore' ? <ExplorePanel /> : <Sidebar />}
        <MapView />
      </div>
    </div>
  )
}
