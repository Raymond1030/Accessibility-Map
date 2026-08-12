# 移动端适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让等时圈工具在手机上可用——地图全屏，控件收进可折叠的底部抽屉，加点改为显式选点模式。

**Architecture:** 单一 DOM 结构，由 CSS 媒体查询切换形态。`<aside class="sidebar">` 在桌面端是左侧固定栏，在移动端变成底部抽屉，不做第二套组件。唯一有分支的 JS 逻辑是「该不该响应地图点击」，抽成纯函数单独测试。

**Tech Stack:** React 18 · TypeScript · CSS 媒体查询 · zustand（沿用现有）· matchMedia

## Global Constraints

- **断点 768px**：`max-width: 768px` 时启用移动端形态。
- **抽屉两档**：折叠露出 90px，展开 72vh。`translateY(calc(72vh - 90px))` 是折叠位移，**这两个数字是唯一输入，改其一必须同步改计算式**。
- **不做拖拽手势**，只做点击把手切换。
- **不做第三档**（半开）。
- **桌面端行为零变化**——任何改动如果影响了 >768px 下的表现，就是做错了。
- **移动端触摸目标 `min-height: 44px`**（iOS 人机指南最小可点尺寸），桌面端保持现有紧凑尺寸。
- **功能集两端完全一致**，不做移动端功能裁剪。
- 所有面向用户的文案用简体中文。

---

### Task 1: 地图点击判定与移动端检测

**Files:**
- Create: `src/ui/responsive.ts`
- Test: `src/ui/responsive.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `MOBILE_BREAKPOINT`、`MOBILE_MEDIA_QUERY`、`shouldAddOnMapClick(isMobile, picking)`、`useIsMobile()`

- [ ] **Step 1: 写失败的测试**

`src/ui/responsive.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { shouldAddOnMapClick, MOBILE_BREAKPOINT, MOBILE_MEDIA_QUERY } from './responsive'

describe('shouldAddOnMapClick', () => {
  it('桌面端直接点地图就能加点，与选点模式无关', () => {
    expect(shouldAddOnMapClick(false, false)).toBe(true)
    expect(shouldAddOnMapClick(false, true)).toBe(true)
  })

  it('移动端未进入选点模式时不加点——否则拖动地图、收抽屉都会误触', () => {
    expect(shouldAddOnMapClick(true, false)).toBe(false)
  })

  it('移动端进入选点模式后才加点', () => {
    expect(shouldAddOnMapClick(true, true)).toBe(true)
  })
})

describe('断点常量', () => {
  it('断点是 768', () => {
    expect(MOBILE_BREAKPOINT).toBe(768)
  })

  it('媒体查询串由断点派生，避免两处写死后不同步', () => {
    expect(MOBILE_MEDIA_QUERY).toBe('(max-width: 768px)')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ui/responsive.test.ts`
Expected: FAIL，报 `./responsive` 模块不存在

- [ ] **Step 3: 实现**

`src/ui/responsive.ts`：

```ts
import { useEffect, useState } from 'react'

export const MOBILE_BREAKPOINT = 768

/** 由断点派生，避免 CSS 与 JS 两处各写一个数字后失去同步 */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`

/**
 * 该不该响应地图点击加点。
 *
 * 桌面端一直可以点。移动端必须先进选点模式——手机上拖动地图浏览、
 * 点击收起抽屉都会命中地图，直接加点会持续误触；而每误加一个点
 * 会立刻发出 3 次 ArrivalRange 请求，配额是实打实烧掉的。
 */
export function shouldAddOnMapClick(isMobile: boolean, picking: boolean): boolean {
  return !isMobile || picking
}

/** 监听断点变化——屏幕旋转时要能实时切换形态 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/ui/responsive.test.ts`
Expected: PASS，5 个测试通过

- [ ] **Step 5: 提交**

```bash
git add src/ui/
git commit -m "feat: 移动端断点常量与地图点击判定"
```

---

### Task 2: 抽屉与选点模式的状态

**Files:**
- Modify: `src/state/store.ts`

**Interfaces:**
- Consumes: 无
- Produces: store 新增 `drawerOpen: boolean`、`pickingMode: boolean`、`setDrawerOpen(open)`、`toggleDrawer()`、`setPickingMode(on)`

本任务无单元测试：新增的是三个直接赋值的 setter，没有分支逻辑。真正有判断的部分在 Task 1 已测；行为组合在 Task 5 的视觉验证里确认。

- [ ] **Step 1: 在 State 类型中加入新状态**

在 `src/state/store.ts` 的 `type State = {` 内，`fatalError: string | null` 之后加入：

```ts
  drawerOpen: boolean
  pickingMode: boolean
```

在 `setFatalError: (msg: string | null) => void` 之后加入：

```ts
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  setPickingMode: (on: boolean) => void
```

- [ ] **Step 2: 加入初始值**

在 `useStore` 的初始状态里，`fatalError: null,` 之后加入：

```ts
  drawerOpen: false,
  pickingMode: false,
```

初始折叠：移动端首屏应该先看到地图。桌面端这个值不影响布局（CSS 只在移动端读它）。

- [ ] **Step 3: 加入 action 实现**

在 `setFatalError: (fatalError) => set({ fatalError }),` 之后加入：

```ts
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),
  setPickingMode: (pickingMode) => set({ pickingMode }),
```

- [ ] **Step 4: 加点后收起抽屉并退出选点模式**

在 `addOrigin` 的实现里，把现有的 `set({ ... })` 调用改为一并重置这两个状态：

```ts
    set({
      origins: [...origins, next],
      baseOriginId: get().baseOriginId ?? id,
      // 加点后总是让用户看到地图：收起抽屉、退出选点模式。
      // 点击加点和搜索加点都走这里，行为自然统一。
      drawerOpen: false,
      pickingMode: false,
    })
```

- [ ] **Step 5: 确认编译与测试**

Run: `npx tsc --noEmit && npm test`
Expected: 编译无错，全部测试通过

- [ ] **Step 6: 提交**

```bash
git add src/state/store.ts
git commit -m "feat: 抽屉展开与选点模式状态"
```

---

### Task 3: 地图接入选点模式

**Files:**
- Modify: `src/components/MapView.tsx`
- Modify: `src/components/MapView.css`

**Interfaces:**
- Consumes: `shouldAddOnMapClick`、`useIsMobile`（Task 1）；`pickingMode`、`setPickingMode`（Task 2）
- Produces: 地图在选点模式下显示提示条；移动端未进选点模式时点击地图不加点

- [ ] **Step 1: 引入依赖**

在 `src/components/MapView.tsx` 顶部 import 区加入：

```tsx
import { shouldAddOnMapClick, useIsMobile } from '../ui/responsive'
```

- [ ] **Step 2: 在组件内取状态**

在 `const setFatalError = useStore((s) => s.setFatalError)` 之后加入：

```tsx
  const pickingMode = useStore((s) => s.pickingMode)
  const setPickingMode = useStore((s) => s.setPickingMode)
  const isMobile = useIsMobile()
```

- [ ] **Step 3: 用 ref 让 click 回调读到最新状态**

地图的 `click` 监听只在建图时绑定一次，闭包会永远捕获首次渲染的值。用 ref 兜住最新状态。

在 `const markerRef = useRef<any[]>([])` 之后加入：

```tsx
  // 建图的 effect 只跑一次，click 闭包会锁死首次渲染的 isMobile/pickingMode。
  // 用 ref 让回调始终读到当前值。
  const clickGuardRef = useRef({ isMobile: false, picking: false })
  clickGuardRef.current = { isMobile, picking: pickingMode }
```

- [ ] **Step 4: 改写地图点击处理**

把建图 effect 里的这一行：

```tsx
        map.on('click', (e: any) => addOrigin([e.lnglat.getLng(), e.lnglat.getLat()], ''))
```

替换为：

```tsx
        map.on('click', (e: any) => {
          const { isMobile: mob, picking } = clickGuardRef.current
          if (!shouldAddOnMapClick(mob, picking)) return
          addOrigin([e.lnglat.getLng(), e.lnglat.getLat()], '')
        })
```

`addOrigin` 内部已经会重置 `pickingMode`（Task 2 Step 4），这里不需要再关一次。

- [ ] **Step 5: 加上选点模式的提示条**

把组件末尾的 return：

```tsx
  return <div className="map-view" ref={containerRef} />
```

替换为：

```tsx
  return (
    <div className="map-view-wrap">
      <div className="map-view" ref={containerRef} />
      {pickingMode && (
        <div className="picking-hint">
          点击地图选择起点
          <button onClick={() => setPickingMode(false)}>取消</button>
        </div>
      )}
    </div>
  )
```

- [ ] **Step 6: 屏幕旋转时重算地图尺寸**

高德在容器尺寸变化时不会自动重算，旋转屏幕后地图会拉伸变形。在建图 effect **之后**新增一个 effect：

```tsx
  // 高德不会自己感知容器尺寸变化，旋转屏幕后地图会拉伸
  useEffect(() => {
    const onResize = () => mapRef.current?.resize?.()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
```

- [ ] **Step 7: 加样式**

`src/components/MapView.css` 全文替换：

```css
.map-view-wrap {
  flex: 1;
  position: relative;
  min-width: 0;
  min-height: 0;
}

.map-view {
  width: 100%;
  height: 100%;
}

.picking-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(17, 24, 39, .92);
  color: #fff;
  font: 13px system-ui, -apple-system, "PingFang SC", sans-serif;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .25);
  white-space: nowrap;
}

.picking-hint button {
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, .35);
  border-radius: 6px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
```

- [ ] **Step 8: 确认编译与测试**

Run: `npx tsc --noEmit && npm test`
Expected: 编译无错，全部测试通过

- [ ] **Step 9: 提交**

```bash
git add src/components/MapView.tsx src/components/MapView.css
git commit -m "feat: 地图选点模式与旋转后重算尺寸"
```

---

### Task 4: 抽屉把手、摘要条与加点按钮

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `drawerOpen`、`toggleDrawer`、`pickingMode`、`setPickingMode`（Task 2）；`useIsMobile`（Task 1）
- Produces: `<aside>` 带 `collapsed` class；抽屉顶部的把手 + 一行结果摘要；移动端的「＋加点」按钮

- [ ] **Step 1: 引入依赖**

在 `src/components/Sidebar.tsx` 顶部 import 区加入：

```tsx
import { useIsMobile } from '../ui/responsive'
```

- [ ] **Step 2: 在组件内取状态并算出摘要文案**

在 `const nameOf = ...` 这一行之后加入：

```tsx
  const isMobile = useIsMobile()

  // 折叠时只露这一行，所以要挑最有信息量的那档：优先第一个算出结果的，
  // 否则退回第一档的状态描述。没有它，折叠状态下用户完全不知道发生了什么。
  const summary = (() => {
    if (visibleIds.length < 2) return '至少需要两个起点'
    const hit = results.find((r) => r.result.kind === 'ok')
    if (hit && hit.result.kind === 'ok') {
      return `${hit.minutes} 分钟 · ${formatArea(hit.result.areaSqM)}`
    }
    const first = results[0]
    if (!first) return '选择时间档位'
    if (first.result.kind === 'loading') return '计算中'
    if (first.result.kind === 'empty') return `${first.minutes} 分钟 · ${EMPTY_TEXT[s.op]}`
    return '数据不全，无法计算'
  })()
```

- [ ] **Step 3: 加上把手与摘要条**

把 `<aside className="sidebar">` 这一行替换为：

```tsx
    <aside className={s.drawerOpen ? 'sidebar' : 'sidebar collapsed'}>
      {/* 只在移动端显示（由 CSS 控制），点击切换抽屉两档 */}
      <button className="drawer-handle" onClick={s.toggleDrawer}>
        <span className="grip" />
        <span className="summary">{summary}</span>
        <span className="caret">{s.drawerOpen ? '▾' : '▴'}</span>
      </button>
```

注意 `<aside>` 的闭合标签 `</aside>` 保持不动，把手是插在它的第一个子元素位置。

- [ ] **Step 4: 加上移动端的「＋加点」按钮**

在起点区的 `<SearchBox />` 之后、`{s.origins.length === 0 && ...}` 之前插入：

```tsx
        {isMobile && (
          <button
            className={s.pickingMode ? 'pick-btn on' : 'pick-btn'}
            onClick={() => s.setPickingMode(!s.pickingMode)}
          >
            {s.pickingMode ? '选点中，点击地图落点' : '＋ 在地图上加点'}
          </button>
        )}
```

桌面端不显示这个按钮——那边直接点地图就能加点，行为不变。

- [ ] **Step 5: 确认编译与测试**

Run: `npx tsc --noEmit && npm test`
Expected: 编译无错，全部测试通过

- [ ] **Step 6: 提交**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: 抽屉把手、结果摘要条与移动端加点按钮"
```

---

### Task 5: 响应式样式

**Files:**
- Modify: `src/components/Sidebar.css`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 4 产出的 `.drawer-handle`、`.grip`、`.summary`、`.caret`、`.pick-btn`、`.sidebar.collapsed`
- Produces: 移动端底部抽屉形态；桌面端表现零变化

- [ ] **Step 1: 桌面端默认隐藏把手，加上加点按钮样式**

在 `src/components/Sidebar.css` 末尾追加：

```css
/* 把手只属于移动端形态，桌面端不存在 */
.drawer-handle { display: none; }

.pick-btn {
  width: 100%;
  min-height: 44px;
  margin-bottom: 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  cursor: pointer;
}
.pick-btn.on {
  background: #111827;
  color: #fff;
  border-color: #111827;
}
```

- [ ] **Step 2: 加移动端媒体查询**

继续在 `src/components/Sidebar.css` 末尾追加：

```css
@media (max-width: 768px) {
  /* 抽屉：浮在全屏地图之上。
     72vh 与 90px 是这套位移的唯一两个输入——
     改其中任何一个，下面 translateY 的计算式必须同步改。 */
  .sidebar {
    position: fixed;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 72vh;
    border-right: none;
    border-top: 1px solid #e2e2e5;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, .12);
    transition: transform .25s ease;
    z-index: 300;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .sidebar.collapsed {
    transform: translateY(calc(72vh - 90px));
  }

  .drawer-handle {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    padding: 8px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    position: relative;
  }

  /* 顶部那条小横杠，提示这里可以点 */
  .grip {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: #d1d5db;
  }

  .summary {
    flex: 1;
    text-align: left;
    font-size: 14px;
    font-weight: 600;
    color: #111827;
    margin-top: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    color: #9ca3af;
    margin-top: 6px;
  }

  /* 内容滚到底时不要把整个页面一起拽动 */
  .pane.origins {
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  /* 触摸目标放大到 iOS 建议的 44px 下限 */
  .chip,
  .search-box button,
  .search-box input,
  select,
  .export,
  .retry {
    min-height: 44px;
  }

  .chip { padding: 0 14px; font-size: 14px; }
  .icon { min-width: 44px; min-height: 44px; font-size: 20px; }
  .label-input { min-height: 44px; font-size: 15px; }

  /* iOS 上字号小于 16px 会在聚焦时自动放大页面 */
  .search-box input { font-size: 16px; }
}
```

- [ ] **Step 3: 让地图在移动端铺满**

`src/App.css` 全文替换：

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
.app { height: 100%; display: flex; flex-direction: column; }
.app-body { flex: 1; display: flex; min-height: 0; }
.fatal {
  background: #fef2f2; color: #991b1b; padding: 8px 12px;
  border-bottom: 1px solid #fecaca;
  font: 13px system-ui, -apple-system, "PingFang SC", sans-serif;
}

@media (max-width: 768px) {
  /* 地图占满整个 app-body，抽屉用 fixed 浮在它上面。
     侧栏不再参与 flex 排布，所以这里不用改 flex-direction。 */
  .app-body { position: relative; }
  .map-view-wrap { position: absolute; inset: 0; }
}
```

- [ ] **Step 4: 确认桌面端没被改坏**

Run: `npm run build`
Expected: 构建成功

启动 `npm run dev`，在宽窗口（>768px）下打开 http://localhost:5173，确认：左侧栏仍是 300px 固定宽、地图占右侧、没有把手条、没有「＋加点」按钮。**桌面端任何可见变化都意味着做错了。**

- [ ] **Step 5: 提交**

```bash
git add src/components/Sidebar.css src/App.css
git commit -m "feat: 移动端底部抽屉样式与 44px 触摸目标"
```

---

### Task 6: 真实尺寸下的视觉验证

**Files:**
- 不改代码，只验证与修缺陷

**Interfaces:**
- Consumes: Task 1–5 的全部产出
- Produces: 两个尺寸下的验证结论

布局是 CSS，无法有意义地单元测试，这一步是它唯一的验证手段。

- [ ] **Step 1: 部署到线上**

```bash
git push origin main
gh run watch $(gh run list --repo Raymond1030/Accessibility-Map --limit 1 --json databaseId -q '.[0].databaseId') --repo Raymond1030/Accessibility-Map --exit-status
```

必须在线上验证而非本地：高德 Key 的域名白名单只放行了 `raymond1030.github.io`，本地起的服务拿不到等时圈数据。

- [ ] **Step 2: 在 390×844（iPhone 14）下截图检查**

用同源 iframe 强制窄视口（headless 下 `window.resizeTo` 无效）：

```js
document.body.innerHTML = '<iframe id="ph" src="/Accessibility-Map/?v=m1" style="width:390px;height:844px;border:2px solid #333;display:block;margin:0"></iframe>';
document.body.style.margin = '0';
```

逐项确认：

1. 地图铺满整个视口，不再被侧栏挤成竖条
2. 抽屉折叠时只露出把手与一行摘要，约 90px
3. 摘要条显示的是有信息量的内容（面积 / 「无共同可达区」/「至少需要两个起点」），不是空白
4. 点把手能展开到 72vh，再点收回
5. 「＋加点」按钮可见且高度达到 44px

- [ ] **Step 3: 验证选点模式的完整闭环**

1. 点「＋ 在地图上加点」→ 抽屉应自动收起，地图顶部出现「点击地图选择起点」提示条
2. 点地图 → 落点成功，提示条消失，抽屉保持折叠
3. 再点「＋加点」进入模式后点「取消」→ 提示条消失，此时点地图**不应**加点

第 3 条是关键：它验证 `shouldAddOnMapClick` 真的接上了。如果取消后点地图仍会加点，说明 ref 没生效。

- [ ] **Step 4: 在 768×1024（iPad）下截图检查**

把 iframe 尺寸改为 `width:768px;height:1024px`，确认 768px 恰好仍是移动端形态（断点是 `max-width: 768px`，含等于），且抽屉在这个宽度下不显得空旷。

- [ ] **Step 5: 确认桌面端截图无变化**

直接访问 https://raymond1030.github.io/Accessibility-Map/ ，与本次改动前的形态对比：左侧栏 300px、无把手、无加点按钮。

- [ ] **Step 6: 修掉发现的问题并重新验证**

若前述任一项不符，修复后回到 Step 1 重新部署验证。不要跳过重新验证——CSS 改动经常修好一处坏掉另一处。

- [ ] **Step 7: 更新 README**

在 README 的功能说明中补一段移动端用法：

```markdown
### 手机上怎么用

地图全屏，控件收在底部抽屉里。点顶部把手展开或收起——折叠时那一行会一直显示当前的结果摘要。

加点要先点「＋ 在地图上加点」进入选点模式，再点地图落点。**手机上不能直接点地图加点**：拖动浏览、收起抽屉都会命中地图，而每误加一个点会立刻发出 3 次高德请求，配额是实打实烧掉的。
```

- [ ] **Step 8: 提交**

```bash
git add README.md
git commit -m "docs: 补移动端用法说明"
git push origin main
```

---

## Self-Review 记录

**Spec 覆盖检查：**

| Spec 章节 | 对应任务 |
|---|---|
| 1 问题（侧栏挤死地图） | Task 5 Step 2/3 |
| 1 问题（误触加点烧配额） | Task 1、Task 3、Task 4 Step 4 |
| 1 问题（触摸目标过小） | Task 5 Step 2 |
| 2.1 单一 DOM，CSS 切换 | Task 5（无第二套组件） |
| 2.2 断点 768px | Task 1（常量）、Task 5（媒体查询） |
| 2.3 抽屉两档 | Task 2（状态）、Task 4（把手）、Task 5（位移） |
| 2.4 overscroll-behavior | Task 5 Step 2 |
| 2.4 safe-area-inset-bottom | Task 5 Step 2 |
| 2.5 旋转时 map.resize() | Task 3 Step 6 |
| 3.1 新增状态 | Task 2 |
| 3.2 加点流程（收抽屉、退模式） | Task 2 Step 4、Task 3 Step 4、Task 4 Step 4 |
| 3.2 搜索加点也收抽屉 | Task 2 Step 4（两条路径都走 addOrigin） |
| 3.3 桌面端不变 | Task 5 Step 4、Task 6 Step 5 |
| 3.3 shouldAddOnMapClick | Task 1 |
| 3.4 触摸目标 44px | Task 5 Step 2 |
| 4 单元测试四用例 | Task 1 Step 1（桌面×2 + 移动×2） |
| 4 两个尺寸视觉验证 | Task 6 Step 2/4 |
| 5 不做清单 | 全程未出现拖拽手势、第三档、功能裁剪 |

无未覆盖项。

**计划外补充的两项**，均为实现必需而 spec 未展开：

- **Task 3 Step 3 的 ref**：地图 `click` 监听在建图 effect 里只绑定一次，闭包会锁死首次渲染的 `isMobile`/`pickingMode`。不用 ref 兜住，选点模式永远读到初始值 `false`，功能直接失效。
- **Task 4 Step 2 的摘要文案**：spec 说折叠时「露出一行结果摘要」，但没定义摘要取哪一档。这里定为「优先第一个算出结果的档位，否则退回第一档的状态描述」——否则折叠状态下用户看不出任何变化。

**已知取舍：**

- Task 2 无单元测试。新增的是三个直接赋值的 setter，无分支逻辑；有判断的部分在 Task 1 已测，行为组合由 Task 6 的视觉验证覆盖。
- iOS 输入框字号强制 16px（Task 5 Step 2）。小于 16px 时 Safari 会在聚焦输入框时自动放大整个页面，且不会自动缩回。这是平台行为，只能靠字号规避。

