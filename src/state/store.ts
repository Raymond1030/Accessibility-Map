import { create } from 'zustand'
import { cellKey, type BandMode, type Origin, type SetOp, type TransitPolicy } from '../types'
import type { PolyFeature } from '../geometry/ops'
import type { CellStatus } from '../geometry/result'
import { getProvider } from '../providers'
import { planRequests } from './compute'

const PALETTE = ['#e4572e', '#3f88c5', '#2e933c', '#8b5cf6', '#d97706']

type State = {
  origins: Origin[]
  bandMode: BandMode
  globalThresholds: number[]
  op: SetOp
  baseOriginId: string | null
  cells: Map<string, CellStatus>
  geoms: Map<string, PolyFeature | null>
  errors: Map<string, string>
  fatalError: string | null

  addOrigin: (lngLat: [number, number], label: string) => void
  removeOrigin: (id: string) => void
  updateOrigin: (id: string, patch: Partial<Origin>) => void
  setPolicy: (id: string, policy: TransitPolicy) => void
  setBandMode: (m: BandMode) => void
  setGlobalThresholds: (t: number[]) => void
  setOp: (op: SetOp) => void
  setBaseOrigin: (id: string | null) => void
  setFatalError: (msg: string | null) => void
  refresh: () => Promise<void>
  retryCell: (originId: string, minutes: number) => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  origins: [],
  bandMode: 'paired',
  globalThresholds: [15, 30, 45],
  op: 'intersect',
  baseOriginId: null,
  cells: new Map(),
  geoms: new Map(),
  errors: new Map(),
  fatalError: null,

  addOrigin: (lngLat, label) => {
    const origins = get().origins
    const id = `o${Date.now().toString(36)}${origins.length}`
    const next: Origin = {
      id,
      label: label || `起点 ${origins.length + 1}`,
      lngLat,
      mode: 'transit',
      policy: 'ALL',
      thresholds: [...get().globalThresholds],
      color: PALETTE[origins.length % PALETTE.length],
      visible: true,
    }
    set({
      origins: [...origins, next],
      baseOriginId: get().baseOriginId ?? id,
    })
    void get().refresh()
  },

  removeOrigin: (id) => {
    const origins = get().origins.filter((o) => o.id !== id)
    set({
      origins,
      baseOriginId: get().baseOriginId === id ? (origins[0]?.id ?? null) : get().baseOriginId,
    })
    void get().refresh()
  },

  updateOrigin: (id, patch) => {
    set({ origins: get().origins.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
    void get().refresh()
  },

  setPolicy: (id, policy) => get().updateOrigin(id, { policy }),
  setBandMode: (bandMode) => { set({ bandMode }); void get().refresh() },
  setGlobalThresholds: (globalThresholds) => { set({ globalThresholds }); void get().refresh() },
  setOp: (op) => set({ op }),                    // 切换运算不触发请求，纯几何重算
  setBaseOrigin: (baseOriginId) => set({ baseOriginId }),
  setFatalError: (fatalError) => set({ fatalError }),

  refresh: async () => {
    const { origins, bandMode, globalThresholds } = get()
    const plan = planRequests(origins, bandMode, globalThresholds)
    const provider = getProvider()

    const cells = new Map(get().cells)
    for (const p of plan) {
      const key = cellKey(p.originId, p.minutes)
      if (!get().geoms.has(key)) cells.set(key, 'loading')
    }
    set({ cells })

    await Promise.all(plan.map(async (p) => {
      const key = cellKey(p.originId, p.minutes)
      try {
        const geom = await provider.fetch({
          lngLat: p.lngLat, mode: p.mode, minutes: p.minutes, policy: p.policy,
        })
        set((s) => ({
          geoms: new Map(s.geoms).set(key, geom),
          cells: new Map(s.cells).set(key, geom ? 'ok' : 'empty'),
          errors: (() => { const e = new Map(s.errors); e.delete(key); return e })(),
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Key 配置错误是唯一需要全局提示的失败——它必然源于部署没配对
        if (/Key|INVALID_USER_SCODE|USERKEY|DAILY_QUERY_OVER_LIMIT/i.test(msg)) {
          set({ fatalError: msg })
        }
        set((s) => ({
          cells: new Map(s.cells).set(key, 'error'),
          errors: new Map(s.errors).set(key, msg),
        }))
      }
    }))
  },

  retryCell: async (originId, minutes) => {
    const origin = get().origins.find((o) => o.id === originId)
    if (!origin) return
    const key = cellKey(originId, minutes)
    set((s) => ({ cells: new Map(s.cells).set(key, 'loading') }))
    try {
      const geom = await getProvider().fetch({
        lngLat: origin.lngLat, mode: origin.mode, minutes, policy: origin.policy,
      })
      set((s) => ({
        geoms: new Map(s.geoms).set(key, geom),
        cells: new Map(s.cells).set(key, geom ? 'ok' : 'empty'),
        errors: (() => { const e = new Map(s.errors); e.delete(key); return e })(),
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set((s) => ({
        cells: new Map(s.cells).set(key, 'error'),
        errors: new Map(s.errors).set(key, msg),
      }))
    }
  },
}))
