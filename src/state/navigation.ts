import { create } from 'zustand'
import { useCommute } from '../commute/store'
import { useExplore } from '../explore/store'
import { useStore } from './store'

export type Scene = 'isochrone' | 'commute' | 'explore'
export const useNavigation = create<{ scene: Scene; setScene: (scene: Scene) => void }>(set => ({
  scene: 'isochrone',
  setScene: scene => {
    useCommute.getState().setPicking(null)
    useExplore.setState({ picking: false })
    useStore.getState().setPickingMode(false)
    useStore.getState().setDrawerOpen(true)
    set({ scene })
  },
}))
