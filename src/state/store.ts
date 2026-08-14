import { create } from 'zustand'
import { cellKey, MAX_MINUTES, type BandMode, type Mode, type Origin, type SetOp } from '../types'
import type { PolyFeature } from '../geometry/ops'
import type { CellStatus } from '../geometry/result'
import { getProvider } from '../providers'
import { isConfigError } from '../amap/errors'
import { applyCustomThreshold, planRequests } from './compute'

/**
 * 起点配色，经 CVD 验证的固定顺序（blue/orange/aqua/yellow/magenta）。
 * 旧色板在全对检查下硬失败：1↔5 号色正常视力 ΔE 仅 7.5（阈值 15），
 * 色盲模拟下 3↔5 号 ΔE 2.4——几乎同色。
 * 前 3 色通过全对检查（ΔE 9.2/24.0）；4、5 号仅在 ≥4 个起点时出现，
 * 靠 marker 颜色 + 侧栏色条 + 名字这层辅助编码兜底。
 */
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']

type State = {
  origins: Origin[]
  bandMode: BandMode
  globalThresholds: number[]
  customMinutes: number
  op: SetOp
  baseOriginId: string | null
  cells: Map<string, CellStatus>
  geoms: Map<string, PolyFeature | null>
  errors: Map<string, string>
  fatalError: string | null
  drawerOpen: boolean
  pickingMode: boolean

  addOrigin: (lngLat: [number, number], label: string) => void
  removeOrigin: (id: string) => void
  updateOrigin: (id: string, patch: Partial<Origin>) => void
  setMode: (id: string, mode: Mode) => void
  setBandMode: (m: BandMode) => void
  setGlobalThresholds: (t: number[]) => void
  setCustomMinutes: (v: number) => void
  setOp: (op: SetOp) => void
  setBaseOrigin: (id: string | null) => void
  setFatalError: (msg: string | null) => void
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  setPickingMode: (on: boolean) => void
  refresh: () => Promise<void>
  retryCell: (originId: string, minutes: number) => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  origins: [],
  bandMode: 'paired',
  globalThresholds: [15, 30, 45],
  customMinutes: 20,
  op: 'intersect',
  baseOriginId: null,
  cells: new Map(),
  geoms: new Map(),
  errors: new Map(),
  fatalError: null,
  // 初始折叠：移动端首屏应该先看到地图。桌面端 CSS 不读这个值
  drawerOpen: false,
  pickingMode: false,

  addOrigin: (lngLat, label) => {
    const origins = get().origins
    const id = `o${Date.now().toString(36)}${origins.length}`
    const next: Origin = {
      id,
      label: label || `起点 ${origins.length + 1}`,
      lngLat,
      mode: 'driving',
      thresholds: [...get().globalThresholds],
      color: PALETTE[origins.length % PALETTE.length],
      visible: true,
    }
    set({
      origins: [...origins, next],
      baseOriginId: get().baseOriginId ?? id,
      // 加点后总是让用户看到地图：收起抽屉、退出选点模式。
      // 点击加点和搜索加点都走这里，行为自然统一。
      drawerOpen: false,
      pickingMode: false,
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

  setMode: (id, mode) => get().updateOrigin(id, { mode }),
  setBandMode: (bandMode) => { set({ bandMode }); void get().refresh() },
  setGlobalThresholds: (globalThresholds) => { set({ globalThresholds }); void get().refresh() },
  // 松手即生效：拖滑条就是「想用这个时间」的明确意图，不要求再点一次
  // chip 激活；旧的自定义档同时被换掉，避免拖一路留下一串档位
  setCustomMinutes: (v) => {
    const clamped = Math.min(MAX_MINUTES, Math.max(1, Math.round(v)))
    const { customMinutes, globalThresholds } = get()
    set({
      customMinutes: clamped,
      globalThresholds: applyCustomThreshold(globalThresholds, customMinutes, clamped),
    })
    void get().refresh()
  },
  setOp: (op) => set({ op }),                    // 切换运算不触发请求，纯几何重算
  setBaseOrigin: (baseOriginId) => set({ baseOriginId }),
  setFatalError: (fatalError) => set({ fatalError }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),
  // 进入选点模式必然收起抽屉——展开时抽屉占 72vh，地图只剩不到三成，
  // 既难落点又会挡住提示条。退出时不动抽屉：那通常只是取消，
  // 突然弹开面板反而唐突。
  setPickingMode: (pickingMode) =>
    set(pickingMode ? { pickingMode, drawerOpen: false } : { pickingMode }),

  refresh: async () => {
    const { origins, bandMode, globalThresholds } = get()
    const plan = planRequests(origins, bandMode, globalThresholds)

    const cells = new Map(get().cells)
    for (const p of plan) {
      const key = cellKey(p.originId, p.minutes)
      if (!get().geoms.has(key)) cells.set(key, 'loading')
    }
    set({ cells })

    await Promise.all(plan.map(async (p) => {
      const key = cellKey(p.originId, p.minutes)
      try {
        // 数据源按出行方式分发：不同起点可能各用各的 provider
        const geom = await getProvider(p.mode).fetch({
          lngLat: p.lngLat, mode: p.mode, minutes: p.minutes,
        })
        set((s) => ({
          geoms: new Map(s.geoms).set(key, geom),
          cells: new Map(s.cells).set(key, geom ? 'ok' : 'empty'),
          errors: (() => { const e = new Map(s.errors); e.delete(key); return e })(),
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // token 无效/额度用尽/高德配置错误是配置问题，重试无意义，升为全局提示
        if (/token|额度/i.test(msg) || isConfigError(msg)) set({ fatalError: msg })
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
      const geom = await getProvider(origin.mode).fetch({
        lngLat: origin.lngLat, mode: origin.mode, minutes,
      })
      set((s) => ({
        geoms: new Map(s.geoms).set(key, geom),
        cells: new Map(s.cells).set(key, geom ? 'ok' : 'empty'),
        errors: (() => { const e = new Map(s.errors); e.delete(key); return e })(),
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/token|额度/i.test(msg) || isConfigError(msg)) set({ fatalError: msg })
      set((s) => ({
        cells: new Map(s.cells).set(key, 'error'),
        errors: new Map(s.errors).set(key, msg),
      }))
    }
  },
}))
