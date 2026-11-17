import { create } from 'zustand'
import type { CommuteMode, Place } from '../commute/types'
import { defaultWeights, enabledCategories, queryKey, type CategoryId, type ExploreQuery, type LifeProfile, type ReachablePoi, type Weights } from './types'
import { buildProfile } from './profile'
import { drawPlaces, type DrawResult } from './blindbox'

type Settings = { mode: CommuteMode; minutes: number }
type State = {
  view: 'profile' | 'blindbox'; center: Place | null; city: string; picking: boolean
  profileSettings: Settings; blindSettings: Settings; weights: Weights; interests: CategoryId[]
  profile: LifeProfile | null; draw: DrawResult | null; busy: boolean; error: string
  selected: ReachablePoi | null; favorites: ReachablePoi[]; rejected: string[]; seen: Record<string, string[]>
  setView: (view: State['view']) => void
  setCenter: (center: Place, city?: string) => void
  setCity: (city: string) => void
  setSettings: (patch: Partial<Settings>) => void
  setWeight: (id: CategoryId, weight: number) => void
  toggleInterest: (id: CategoryId) => void
  evaluate: () => Promise<void>
  select: (place: ReachablePoi | null) => void
  favorite: (place: ReachablePoi) => void
  reject: (id: string) => void
  resetDraw: () => void
}
let generation = 0; let controller: AbortController | null = null
const cancel = () => { generation++; controller?.abort() }
export function exploreQuery(s: State): ExploreQuery | null {
  if (!s.center || !s.city.trim()) return null
  return { center: s.center, city: s.city.trim(), ...(s.view === 'profile' ? s.profileSettings : s.blindSettings) }
}
export const drawKey = (q: ExploreQuery, interests: CategoryId[]) => `${queryKey(q)}:${[...interests].sort().join(',')}`
export const useExplore = create<State>((set, get) => ({
  view: 'profile', center: null, city: '深圳', picking: false,
  profileSettings: { mode: 'walking', minutes: 15 }, blindSettings: { mode: 'transit', minutes: 30 },
  weights: defaultWeights(), interests: ['park', 'bookstore', 'museum'], profile: null, draw: null,
  busy: false, error: '', selected: null, favorites: [], rejected: [], seen: {},
  setView: view => { cancel(); set({ view, busy: false, error: '', picking: false, selected: null }) },
  setCenter: (center, city) => { cancel(); set({ center, ...(city ? { city } : {}), profile: null, draw: null, selected: null, busy: false, picking: false, error: '' }) },
  setCity: city => { cancel(); set({ city, profile: null, draw: null, selected: null, busy: false, error: '' }) },
  setSettings: patch => {
    cancel()
    const key = get().view === 'profile' ? 'profileSettings' : 'blindSettings'
    const settings = { ...get()[key], ...patch }
    settings.minutes = Math.min(60, Math.max(1, Math.round(settings.minutes) || 1))
    set({ [key]: settings, ...(key === 'profileSettings' ? { profile: null } : { draw: null }), selected: null, busy: false, error: '' })
  },
  setWeight: (id, weight) => {
    const old = get().weights[id]; const next = Math.max(0, Math.min(5, Math.round(weight) || 0))
    if ((!old !== !next) && get().busy) { cancel(); set({ busy: false }) }
    set({ weights: { ...get().weights, [id]: next } })
  },
  toggleInterest: id => { cancel(); set({ interests: get().interests.includes(id) ? get().interests.filter(c => c !== id) : [...get().interests, id], draw: null, selected: null, busy: false, error: '' }) },
  evaluate: async () => {
    const s = get(); const q = exploreQuery(s)
    if (!q || s.busy) return
    const categories = s.view === 'profile' ? enabledCategories(s.weights) : s.interests
    if (!categories.length) { set({ error: '请至少选择一个类别。' }); return }
    cancel(); controller = new AbortController(); const signal = controller.signal; const run = generation
    set({ busy: true, error: '', selected: null, ...(s.view === 'profile' ? { profile: null } : { draw: null }) })
    try {
      if (s.view === 'profile') {
        const profile = await buildProfile(q, categories, signal, profile => { if (run === generation) set({ profile }) })
        if (run === generation) set({ profile })
      } else {
        const key = drawKey(q, categories)
        const excluded = new Set([...(s.seen[key] ?? []), ...s.favorites.map(p => p.poi.id), ...s.rejected])
        const draw = await drawPlaces(q, categories, excluded, signal)
        if (run === generation) set({ draw, seen: { ...get().seen, [key]: [...(get().seen[key] ?? []), ...draw.places.map(p => p.poi.id)] } })
      }
    } catch (error) { if (run === generation) set({ error: error instanceof Error ? error.message : String(error) }) }
    finally { if (run === generation) set({ busy: false }) }
  },
  select: selected => set({ selected }),
  favorite: place => set({ favorites: get().favorites.some(p => p.poi.id === place.poi.id) ? get().favorites.filter(p => p.poi.id !== place.poi.id) : [...get().favorites, place] }),
  reject: id => set({ rejected: [...new Set([...get().rejected, id])], draw: get().draw ? { ...get().draw!, places: get().draw!.places.filter(p => p.poi.id !== id) } : null,
    selected: get().selected?.poi.id === id ? null : get().selected }),
  resetDraw: () => {
    const q = exploreQuery(get()); if (!q) return
    const key = drawKey(q, get().interests)
    set({ seen: { ...get().seen, [key]: [] }, draw: null, selected: null })
  },
}))
