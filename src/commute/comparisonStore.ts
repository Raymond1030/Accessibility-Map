import { create } from 'zustand'
import { useCommute } from './store'
import { roundTrip, type RoundTrip, type Visit } from './comparison'
import type { CommuteMode, Place, Route } from './types'
import { defaultWeights, enabledCategories, type LifeProfile, type Weights } from '../explore/types'
import { buildProfile } from '../explore/profile'
import { checkSignal } from '../explore/requests'
import { verifyChanges, type PoiChanges } from '../explore/changes'
import type { CategoryId } from '../explore/types'

type State = {
  changes: Partial<Record<CategoryId, PoiChanges>>
  inspection: { origin: Place; destination: Place; route: Route } | null
  baseId: string | null; targetId: string | null; days: number; visits: Visit[]; workWeekly: number
  weights: Weights; profileMode: CommuteMode; profileMinutes: number
  trips: Record<string, Record<string, RoundTrip>>; profiles: Record<string, LifeProfile>
  busy: boolean; error: string; profilesRequested: boolean
  setPair: (baseId: string | null, targetId: string | null) => void
  setDays: (days: number) => void
  setVisits: (visits: Visit[]) => void
  setWorkWeekly: (weekly: number) => void
  setProfileSettings: (mode: CommuteMode, minutes: number) => void
  setWeights: (weights: Weights) => void
  invalidate: () => void
  evaluate: (includeLife: boolean) => Promise<void>
}
let generation = 0; let controller: AbortController | null = null
function cancel() { generation++; controller?.abort() }
export function selectedPair() {
  const c = useCommute.getState(); const s = useComparison.getState()
  const base = c.homes.find(h => h.id === s.baseId) ?? c.homes[0]
  const target = c.homes.find(h => h.id === s.targetId && h.id !== base?.id) ?? c.homes.find(h => h.id !== base?.id)
  return { base, target }
}
export function effectiveVisits(): Visit[] {
  const c = useCommute.getState(); const s = useComparison.getState()
  return [...(c.workplace ? [{ id: 'work', place: c.workplace, city: c.destinationCity, mode: c.mode, weekly: s.workWeekly }] : []), ...s.visits]
}
export const useComparison = create<State>((set, get) => ({
  changes: {},
  inspection: null,
  baseId: null, targetId: null, days: 22, visits: [], workWeekly: 5,
  weights: defaultWeights(), profileMode: 'walking', profileMinutes: 15,
  trips: {}, profiles: {}, busy: false, error: '', profilesRequested: false,
  invalidate: () => { cancel(); set({ trips: {}, profiles: {}, changes: {}, busy: false, error: '', profilesRequested: false, inspection: null }) },
  setPair: (baseId, targetId) => { get().invalidate(); set({ baseId, targetId }) },
  setDays: days => set({ days: Math.max(1, Math.min(31, Math.round(days) || 1)) }),
  setVisits: visits => {
    if (JSON.stringify(visits.map(({ weekly: _, ...v }) => v)) !== JSON.stringify(get().visits.map(({ weekly: _, ...v }) => v))) get().invalidate()
    set({ visits: visits.slice(0, 5) })
  },
  setWorkWeekly: workWeekly => set({ workWeekly: Math.max(0, Math.min(21, Math.round(workWeekly) || 0)) }),
  setProfileSettings: (profileMode, minutes) => { get().invalidate(); set({ profileMode, profileMinutes: Math.min(60, Math.max(1, Math.round(minutes) || 1)) }) },
  setWeights: weights => {
    if (enabledCategories(weights).join() !== enabledCategories(get().weights).join()) {
      cancel(); set({ profiles: {}, changes: {}, busy: false })
    }
    set({ weights })
  },
  evaluate: async includeLife => {
    const { base, target } = selectedPair(); const c = useCommute.getState(); const s = get()
    if (!base || !target || !c.city.trim() || s.busy) return
    cancel(); controller = new AbortController(); const signal = controller.signal; const run = generation
    const visits = includeLife ? effectiveVisits() : effectiveVisits().filter(v => v.id === 'work')
    set({ busy: true, error: '', trips: {}, profiles: {}, changes: {}, profilesRequested: includeLife, inspection: null })
    const tasks: Promise<unknown>[] = []
    for (const home of [base, target]) {
      for (const visit of visits) {
        tasks.push(roundTrip(home, c.city, visit, signal).then(trip => {
          if (run === generation) set(s => ({ trips: { ...s.trips, [home.id]: { ...s.trips[home.id], [visit.id]: trip } } }))
        }))
      }
      if (includeLife && enabledCategories(s.weights).length) tasks.push(buildProfile({ center: home, city: c.city, mode: s.profileMode, minutes: s.profileMinutes }, enabledCategories(s.weights), signal,
        profile => { if (run === generation) set(s => ({ profiles: { ...s.profiles, [home.id]: profile } })) })
        .catch(e => { checkSignal(signal); if (run === generation) set(s => ({ error: `${s.error}${s.error ? '；' : ''}${home.name}：${e instanceof Error ? e.message : String(e)}` })) }))
    }
    try {
      await Promise.all(tasks)
      checkSignal(signal)
      const profiles = get().profiles
      if (includeLife && profiles[base.id] && profiles[target.id]) {
        const changes = await verifyChanges(profiles[base.id], profiles[target.id], enabledCategories(s.weights), signal)
        if (run === generation) set({ changes })
      }
    }
    catch (e) { if (run === generation) set({ error: e instanceof Error ? e.message : String(e) }) }
    finally { if (run === generation) set({ busy: false }) }
  },
}))
// Input edits invalidate every result derived from that input, including an
// in-flight callback. Rent and frequency changes only recompute pure totals.
useCommute.subscribe((s, old) => {
  if (s.view !== old.view || s.selectedId !== old.selectedId) useComparison.setState({ inspection: null })
  if (s.workplace !== old.workplace || s.city !== old.city || s.destinationCity !== old.destinationCity || s.mode !== old.mode ||
      s.homes.map(h => `${h.id}:${h.lngLat}`).join('|') !== old.homes.map(h => `${h.id}:${h.lngLat}`).join('|')) useComparison.getState().invalidate()
})
