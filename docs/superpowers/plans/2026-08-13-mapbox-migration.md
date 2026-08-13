# Mapbox 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数据源与底图整体切换到 Mapbox，提供驾车（含实时路况可选）/步行/骑行三类等时圈，全栈 WGS-84。

**Architecture:** provider 抽象层保持不变，`mapbox.ts` 替换 `amapTransit.ts`；地图渲染层用 Mapbox GL JS 重写（GeoJSON source + layer 模式，替代高德的覆盖物模式）；几何层、缓存、闸门、超时、compute 编排原样保留。公交能力与 `policy` 字段一并移除。

**Tech Stack:** mapbox-gl 3.28（v3 API，与网上 v2 教程有出入）· Mapbox Isochrone / Geocoding API · 其余沿用

## Global Constraints

- **`Mode = 'driving' | 'driving-traffic' | 'walking' | 'cycling'`**，无 transit。
- **`driving-traffic` 的缓存指纹拼入 10 分钟时间桶**（`Math.floor(now / 600_000)`），其余 mode 不含时间桶。
- **档位匹配必须按 `properties.contour`，禁止数组下标**（`mapboxTransform.ts` 已实现并测试）。
- **中文标注是必需项**：style 加载后把所有 symbol 图层的 `text-field` 改为 `['coalesce', ['get','name_zh-Hans'], ['get','name_zh-Hant'], ['get','name']]`。
- **token 不得出现在任何源码文件**——GitHub 推送保护会拦截 Mapbox token。运行时一律 `import.meta.env.VITE_MAPBOX_TOKEN`。
- 导出 GeoJSON 的 `properties.crs` 改为 `'WGS-84'`。
- `geo/coord.ts` 保留不删，文件顶部注明当前未被调用及保留原因。
- 桌面/移动两种形态的交互（抽屉、选点模式、44px 触摸目标）不得因地图库更换而退化。
- 面向用户文案：`driving`「驾车」、`driving-traffic`「驾车（实时路况）」、`walking`「步行」、`cycling`「骑行」。

---

### Task 1: 类型与缓存时间桶

**Files:**
- Modify: `src/types.ts`（Mode 改四值，删 `TransitPolicy` 与 `Origin.policy`，加 `MODE_LABEL`）
- Modify: `src/providers/cache.ts`（指纹加时间桶，`IsochroneRequest` 删 policy）
- Modify: `src/providers/cache.test.ts`、`src/state/compute.ts`、`src/state/compute.test.ts`、`src/state/store.ts`（policy 引用清除；store 的 `setPolicy` 换成 `setMode(id, mode)`）
- Test: `src/providers/cache.test.ts`

**Interfaces:**
- Produces: `Mode`（四值）、`MODE_LABEL: Record<Mode, string>`、`requestFingerprint(providerId, req, now?)`——`now` 可注入以便测试；store 的 `setMode(id: string, mode: Mode)`

- [ ] **Step 1: 在 cache.test.ts 写失败的时间桶测试**

```ts
describe('driving-traffic 的时间桶', () => {
  const tReq = (over: Partial<IsochroneRequest> = {}): IsochroneRequest => ({
    lngLat: [116.397, 39.909], mode: 'driving-traffic', minutes: 30, ...over,
  })

  it('同一 10 分钟窗口内指纹相同——会话内仍享受零请求', () => {
    expect(requestFingerprint('mb', tReq(), 1_000_000_000))
      .toBe(requestFingerprint('mb', tReq(), 1_000_000_000 + 9 * 60_000))
  })

  it('跨窗口指纹不同——路况过期后重新获取', () => {
    expect(requestFingerprint('mb', tReq(), 1_000_000_000))
      .not.toBe(requestFingerprint('mb', tReq(), 1_000_000_000 + 11 * 60_000))
  })

  it('普通驾车不含时间桶，任何时刻指纹一致', () => {
    const d = (now: number) => requestFingerprint('mb', tReq({ mode: 'driving' }), now)
    expect(d(0)).toBe(d(999_999_999))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（编译错，mode 类型不含 driving-traffic）
- [ ] **Step 3: 改 types.ts**

```ts
export type Mode = 'driving' | 'driving-traffic' | 'walking' | 'cycling'

export const MODE_LABEL: Record<Mode, string> = {
  driving: '驾车',
  'driving-traffic': '驾车（实时路况）',
  walking: '步行',
  cycling: '骑行',
}
```

`Origin` 删 `policy`，删 `TransitPolicy` 导出。

- [ ] **Step 4: 改 cache.ts 指纹**

```ts
const TRAFFIC_BUCKET_MS = 600_000

export function requestFingerprint(
  providerId: string,
  req: IsochroneRequest,
  now: number = Date.now(),
): string {
  const [lng, lat] = req.lngLat
  // 实时路况会随时间变化，指纹拼入 10 分钟时间桶：
  // 同一时段内切运算/拖回原点仍零请求，跨时段重新获取
  const bucket = req.mode === 'driving-traffic'
    ? `|t${Math.floor(now / TRAFFIC_BUCKET_MS)}`
    : ''
  return [providerId, `${lng.toFixed(5)},${lat.toFixed(5)}`, req.mode, req.minutes]
    .join('|') + bucket
}
```

`IsochroneRequest` 删 `policy`。

- [ ] **Step 5: 清除全部 policy 引用**：compute.ts 的 `PlannedRequest`/`planRequests`、store 的默认值与 `setPolicy`→`setMode(id, mode) => updateOrigin(id, { mode })`、各测试文件的 origin 构造。store 新起点默认 `mode: 'driving'`。
- [ ] **Step 6: `npx tsc --noEmit && npm test` 全绿后提交** `feat: Mode 四值与 driving-traffic 时间桶缓存`

---

### Task 2: Mapbox provider

**Files:**
- Create: `src/mapbox/token.ts`
- Create: `src/providers/mapbox.ts`
- Modify: `src/providers/index.ts`
- Test: `src/providers/mapbox.test.ts`（mock 全局 fetch）

**Interfaces:**
- Consumes: `isochroneUrl` / `pickContour` / `describeMapboxError`（已存在）、`withCache` / `withGate` / `withTimeout`
- Produces: `getMapboxToken()`、`createMapboxProvider()`、`getProvider()`（签名不变）

- [ ] **Step 1: 写失败的 provider 测试**——mock `fetch`：
  - 200 + 正常 body → 返回对应 contour 的 Feature
  - 200 + 空 features → null（无覆盖是有效结果）
  - 401 → reject 且 message 含 `token`
  - 429 → reject（交给外层闸门重试）
  - mode 为四种任一时 URL 走对 profile；`driving-traffic` 映射 `mapbox/driving-traffic`
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

`src/mapbox/token.ts`：

```ts
export class MapboxTokenMissingError extends Error {
  constructor() {
    super('未配置 Mapbox token。请在 .env 填入 VITE_MAPBOX_TOKEN。')
    this.name = 'MapboxTokenMissingError'
  }
}

export function getMapboxToken(): string {
  const t = import.meta.env.VITE_MAPBOX_TOKEN
  if (!t) throw new MapboxTokenMissingError()
  return t
}
```

`src/providers/mapbox.ts`：

```ts
import { isochroneUrl, pickContour, describeMapboxError } from './mapboxTransform'
import { getMapboxToken } from '../mapbox/token'
import type { IsochroneProvider } from './cache'

export function createMapboxProvider(): IsochroneProvider {
  return {
    id: 'mapbox',
    supportedModes: ['driving', 'driving-traffic', 'walking', 'cycling'],
    async fetch(req) {
      const url = isochroneUrl(req.mode, req.lngLat, req.minutes, getMapboxToken())
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(describeMapboxError(res.status, await res.text().catch(() => '')))
      }
      return pickContour(await res.json(), req.minutes)
    },
  }
}
```

`mapboxTransform.ts` 的 `MAPBOX_PROFILE` 补 `'driving-traffic': 'mapbox/driving-traffic'`，对应测试同步更新（transit 不存在的断言保留）。

`providers/index.ts` 换成 `withCache(withGate(withTimeout(createMapboxProvider())))`。

- [ ] **Step 4: 测试通过后提交** `feat: Mapbox Isochrone provider`

---

### Task 3: MapView 用 Mapbox GL JS 重写

**Files:**
- Rewrite: `src/components/MapView.tsx`
- Modify: `src/components/MapView.css`（保留 picking-hint/locate 样式，地图容器不变）
- Modify: `src/main.tsx` 或 MapView 内 `import 'mapbox-gl/dist/mapbox-gl.css'`

**Interfaces:**
- Consumes: store、`computeBand`、`shouldAddOnMapClick`/`useIsMobile`、`locateCurrentPosition`
- Produces: `<MapView />`，行为与高德版一致（点击加点、拖拽 dragend 重算、原始圈铺底、结果高亮、选点提示条、定位按钮、新点自动居中）

要点（v3 API）：

- 建图：`new mapboxgl.Map({ container, style: 'mapbox://styles/mapbox/streets-v12', center, zoom })`，`mapboxgl.accessToken = getMapboxToken()`
- **中文标注**：`map.on('style.load')` 里遍历 `map.getStyle().layers`，symbol 图层 `setLayoutProperty(id, 'text-field', ['coalesce', ['get','name_zh-Hans'], ['get','name_zh-Hant'], ['get','name']])`
- **多边形改 source/layer 模式**：两个 GeoJSON source（`origins-iso` / `result-iso`），初始空集合；渲染 effect 只 `setData()`。origin 层 `fill-color: ['get','color']` + `fill-opacity: 0.12`；result 层深色填充 + `line` 描边。**source/layer 必须在 `load` 事件后添加**，effect 里用 ready 标志守卫
- 标记：`new mapboxgl.Marker({ draggable: true }).setLngLat(...).addTo(map)`，`dragend` 取 `marker.getLngLat()`
- 点击守卫 `clickGuardRef` 逻辑原样保留；`map.on('click', e => e.lngLat.lng / .lat)`
- 新点居中：`map.flyTo({ center, zoom: 12 })`
- 定位：直接 `locateCurrentPosition()`，**其返回已不再需要转换**（Task 5 改 locate）
- 旋转 resize：Mapbox GL 自带 ResizeObserver，**删掉手动 resize effect**

- [ ] Step 1 实现 → Step 2 `tsc && npm test` → Step 3 `npm run dev` 桌面手动冒烟（底图中文、点击加点、等时圈渲染）→ Step 4 提交 `feat: MapView 迁移到 Mapbox GL JS`

---

### Task 4: 搜索与侧栏

**Files:**
- Rewrite: `src/components/SearchBox.tsx`（Mapbox Geocoding）
- Modify: `src/components/Sidebar.tsx`（policy 下拉换 mode 下拉）

**Interfaces:**
- Consumes: `getMapboxToken`、`MODE_LABEL`、store `setMode`
- Produces: 行为不变的搜索框；每起点一个出行方式下拉

SearchBox 核心：

```ts
const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?` +
  new URLSearchParams({ access_token: getMapboxToken(), language: 'zh', country: 'cn', limit: '1' })
const data = await (await fetch(url)).json()
const f = data.features?.[0]
if (!f) throw new Error('没有找到这个地点')
addOrigin(f.center as [number, number], f.text_zh ?? f.text ?? q)
```

失败处理沿用现有模式；`isConfigError` 那套是高德错误码，此处改用简单 401/403 判断（Task 5 删 amap/errors 时一并处理）。

Sidebar：`POLICY_LABEL` 下拉换成 `MODE_LABEL` 下拉，`onChange={e => s.setMode(o.id, e.target.value as Mode)}`。

- [ ] 实现 → `tsc && npm test` → 提交 `feat: Mapbox Geocoding 搜索与出行方式选择`

---

### Task 5: 定位、导出与高德清理

**Files:**
- Modify: `src/geo/locate.ts`（删坐标转换调用，保留境外提示但文案改为「境外路网数据可能不全」级别的提醒）
- Modify: `src/geo/coord.ts`（顶部注明当前未被调用、保留原因）
- Modify: `src/export.ts` + `src/export.test.ts`（crs → `'WGS-84'`）
- Modify: `src/state/store.ts`（fatalError 判定换 Mapbox：`MapboxTokenMissingError` 与 401/403 消息）
- Delete: `src/amap/`（loader、errors 及测试）、`src/providers/amapTransit.ts`、`src/providers/transform.ts` + 测试 + fixtures、`public/mapbox-speed.html`（使命完成）
- Modify: `.github/workflows/deploy.yml`（删测速页注入步骤）、`index.html`（无高德引用则不动）

注意：`locate.ts` 的 `describeGeolocationError` 与测试**原样保留**（与坐标系无关）；删除的是 `wgs84ToGcj02` 调用，`LocateResult.lngLat` 现在就是原始 WGS-84。`outOfChina` 提示保留——Mapbox 国内数据也有边界，但文案从「只支持国内公交」改为「当前位置在中国大陆之外，路网数据可能有限」……实际上迁移后海外反而更准，**直接删掉境外提示与 outsideChina 字段**，相关测试同步删。

- [ ] 实现 → `tsc && npm test`（预期净减：高德解析 20 个测试删除）→ 提交 `feat: 定位直用 WGS-84，清理高德残留`

---

### Task 6: 部署与真实验证

- [ ] **Step 1: README 更新**——三条限制重写（公交→已移除并说明原因；GCJ-02→WGS-84；新增 Mapbox 首次加载慢与标注中文化说明）、架构图、测试数、高德 Key 相关快速开始内容换成 Mapbox token
- [ ] **Step 2: 推送部署**，确认 CI 绿
- [ ] **Step 3: 线上验证清单**：
  1. 底图加载且**标注为中文**
  2. 搜索「深圳湾科技生态园」能落点（Geocoding 国内覆盖实测点）
  3. 单点驾车 15/30/45 出面积且地图有圈
  4. 切「驾车（实时路况）」→ 发出新请求（时间桶生效的旁证）；切回「驾车」→ 零请求（缓存仍在）
  5. 两点交集/并集/差集正常，空交集文案正常
  6. 移动端 iframe 390×844：抽屉、选点模式、定位按钮无退化
  7. 导出 GeoJSON 的 crs 为 WGS-84，坐标与 Mapbox 一致（无偏移）
- [ ] **Step 4: 验证中发现的问题修完再收尾**；Geocoding 若搜不到常用地名，如实报告并把「是否引入高德搜索兜底」交回用户决定
- [ ] **Step 5: 提交** `docs: README 迁移说明` 并推送

---

## Self-Review 记录

**Spec 覆盖**：Mode 四值+时间桶（Task 1）、provider（Task 2）、底图+中文标注（Task 3）、Geocoding（Task 4）、WGS-84 定位/导出/coord 保留（Task 5）、token 安全（Task 2/6，全部走 env）、错误映射（已有 mapboxTransform）、真机验证（Task 6）。无缺口。

**已知取舍**：
- MapView/SearchBox 无单测，与此前对薄封装的策略一致；可测逻辑（URL、contour 匹配、错误映射、时间桶）全部已在纯函数层覆盖。
- 删除测速页：它带 token 注入步骤，留着是持续的泄露面；速度结论已拿到，使命完成。
- `driving-traffic` 缓存的时间桶用注入的 `now` 保持纯函数可测，运行时才用 `Date.now()`。
