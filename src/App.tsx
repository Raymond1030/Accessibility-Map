import { Sidebar } from './components/Sidebar'
import { MapView } from './components/MapView'
import { useStore } from './state/store'
import './App.css'

export default function App() {
  const fatalError = useStore((s) => s.fatalError)

  return (
    <div className="app">
      {fatalError && (
        <div className="fatal">
          <b>配置问题：</b>{fatalError}
        </div>
      )}
      <div className="app-body">
        <Sidebar />
        <MapView />
      </div>
    </div>
  )
}
