import { create } from 'zustand'
import { fetchCommuteRoute } from './amap'
import { COMMUTE_MODES, routeKey, type CommuteMode, type Home, type Place, type RouteCell } from './types'
import { getProvider } from '../providers'
import type { RangeMode, RangeResult } from './range'

let generation = 0
let rangeGeneration = 0
let rangeController: AbortController | null = null

type State = {
  view: 'range' | 'compare' | 'move'
  rangeMode: RangeMode
  rangeMinutes: number
  rangeResult: RangeResult
  setView: (view: State['view']) => void
  setRangeMode: (mode: RangeMode) => void
  setRangeMinutes: (minutes: number) => void
  evaluateRange: () => Promise<void>
  workplace: Place | null
  homes: Home[]
  city: string
  destinationCity: string
  minutes: number
  budget: number | null
  mode: CommuteMode
  cells: Record<string, RouteCell>
  busy: boolean
  selectedId: string | null
  picking: 'work' | 'home' | null
  setWorkplace: (place: Place) => void
  addHome: (place: Place) => void
  removeHome: (id: string) => void
  setRent: (id: string, rent: number | null) => void
  setCities: (city: string, destinationCity: string) => void
  setPicking: (target: State['picking']) => void
  select: (id: string, mode?: CommuteMode) => void
  evaluate: () => Promise<void>
}
export const useCommute = create<State>((set, get) => ({
  workplace: null, homes: [], city: '深圳', destinationCity: '深圳',
  view: 'range', rangeMode: 'subway-walking', rangeMinutes: 30, rangeResult: { status: 'idle' },
  setView: view => set({ view, picking: null }),
  setRangeMode: rangeMode => { rangeGeneration++; rangeController?.abort(); set({ rangeMode, rangeResult: { status: 'idle' } }) },
  setRangeMinutes: minutes => {
    rangeGeneration++
    rangeController?.abort()
    set({ rangeMinutes: Math.max(1, Math.min(60, Math.round(minutes) || 30)), rangeResult: { status: 'idle' } })
  },
  evaluateRange: async () => {
    const { workplace, rangeMode, rangeMinutes, rangeResult } = get()
    if (!workplace || rangeResult.status === 'loading') return
    const run = ++rangeGeneration
    rangeController?.abort()
    rangeController = new AbortController()
    set({ rangeResult: { status: 'loading' } })
    try {
      const geometry = await getProvider(rangeMode).fetch({ lngLat: workplace.lngLat, mode: rangeMode, minutes: rangeMinutes,
        ...(rangeMode === 'subway-walking' ? { direction: 'arrive' as const, signal: rangeController.signal,
          onProgress: (message: string) => {
            if (run === rangeGeneration && get().rangeResult.status === 'loading') set({ rangeResult: { status: 'loading', message } })
          } } : {}),
      })
      if (run === rangeGeneration) set({ rangeResult: geometry ? { status: 'ok', geometry } : { status: 'empty' } })
    } catch (error) {
      if (run === rangeGeneration) set({ rangeResult: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
    }
  },
  minutes: 45, budget: null, mode: 'transit', cells: {}, busy: false, selectedId: null, picking: null,
  setWorkplace: workplace => { generation++; rangeGeneration++; rangeController?.abort(); set({ workplace, cells: {}, busy: false, picking: null, rangeResult: { status: 'idle' } }) },
  addHome: place => {
    if (get().homes.length >= 6) return
    const home = { ...place, id: crypto.randomUUID(), rent: null }
    set({ homes: [...get().homes, home], selectedId: home.id, picking: null })
  },
  removeHome: id => {
    const homes = get().homes.filter(h => h.id !== id)
    set({ homes, selectedId: get().selectedId === id ? homes[0]?.id ?? null : get().selectedId,
      cells: Object.fromEntries(Object.entries(get().cells).filter(([key]) => !key.startsWith(`${id}:`))) })
  },
  setRent: (id, rent) => set({ homes: get().homes.map(h => h.id === id ? { ...h, rent } : h) }),
  setCities: (city, destinationCity) => { generation++; set({ city, destinationCity, cells: {}, busy: false }) },
  setPicking: picking => set({ picking }),
  select: (selectedId, mode) => set({ selectedId, ...(mode ? { mode } : {}) }),
  evaluate: async () => {
    const { workplace, homes, city, destinationCity } = get()
    if (!workplace || !homes.length || !city.trim() || !destinationCity.trim() || get().busy) return
    const run = ++generation
    const tasks = homes.flatMap(home => COMMUTE_MODES.map(mode => ({ home, mode })))
    set({ busy: true, cells: Object.fromEntries(tasks.map(t => [routeKey(t.home.id, t.mode), { status: 'loading' }])) })
    // 最多两个在飞请求；改公司/城市后旧结果失效，旧队列不再继续发请求。
    async function worker() {
      while (run === generation) {
        const task = tasks.shift()
        if (!task) return
        if (!get().homes.some(h => h.id === task.home.id)) continue
        let cell: RouteCell
        try {
          const route = await fetchCommuteRoute({ origin: task.home.lngLat, destination: workplace!.lngLat,
            city: city.trim(), destinationCity: destinationCity.trim(), mode: task.mode })
          cell = route ? { status: 'ok', route } : { status: 'empty' }
        } catch (error) { cell = { status: 'error', message: error instanceof Error ? error.message : String(error) } }
        if (run !== generation) return
        if (get().homes.some(h => h.id === task.home.id)) {
          set(s => ({ cells: { ...s.cells, [routeKey(task.home.id, task.mode)]: cell } }))
        }
      }
    }
    await Promise.all([worker(), worker()])
    if (run === generation) set({ busy: false })
  },
}))
