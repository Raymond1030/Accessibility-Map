# 等时圈与多点可达性交集工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个纯前端应用，用高德 `AMap.ArrivalRange` 计算多个起点的公交等时圈，并对它们做交集 / 并集 / 差集运算。

**Architecture:** 三层。Provider 层是唯一接触高德 API 的地方，对外只吐规范 GeoJSON MultiPolygon；几何层是不碰网络的纯函数；UI 层是单侧栏 + 全屏地图。全栈统一 GCJ-02，不做坐标转换。

**Tech Stack:** React 18 + TypeScript + Vite + Vitest + Turf.js 7 + 高德 JS API 2.0 + zustand

## Global Constraints

- **Turf.js 必须是 7.x**。`intersect` / `union` / `difference` 在 7.x 接收 `FeatureCollection` 单一参数，与网上大量 Turf 6 示例不兼容。
- **`turf.difference(featureCollection([a, b, c]))` 语义为 `a \ (b ∪ c)`**，原生支持多参数，不需手工先 union。
- **坐标系恒为 GCJ-02**，全程不做任何坐标转换。
- **时间档位上限 60 分钟**，`AMap.ArrivalRange` 超过该值行为不可靠。
- **并发上限 4**，所有 provider 请求必须经过闸门。
- **空结果不是错误**。交集为空、差集为空、某点无公交覆盖，三者都是有效结论，必须与请求失败区分。
- **同档模式下，若任一可见起点在某档缺失数据，该档结果为 `unavailable`**，禁止用残缺点集代入运算。
- 所有面向用户的文案用简体中文。

---

### Task 1: 项目骨架与共享类型

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.example`, `.gitignore`
- Create: `src/types.ts`
- Test: `src/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `Mode`, `TransitPolicy`, `Origin`, `BandMode`, `SetOp`, `CellKey`, `cellKey()`

- [ ] **Step 1: 初始化项目与依赖**

```bash
cd /Users/raymond/Documents/Accessibility-Map
npm create vite@latest . -- --template react-ts
npm install
npm install @turf/turf@^7.2.0 zustand@^5.0.0 @amap/amap-jsapi-loader@^1.0.1
npm install -D vitest@^3.0.0 @amap/amap-jsapi-types@^0.0.15
git init
```

- [ ] **Step 2: 配置 Vitest**

写入 `vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

在 `package.json` 的 `scripts` 中加入 `"test": "vitest run"` 与 `"test:watch": "vitest"`。

- [ ] **Step 3: 写入 .gitignore 与 .env.example**

`.gitignore` 追加：

```
node_modules
dist
.env
.superpowers/
```

`.env.example`：

```
VITE_AMAP_KEY=your_amap_js_api_key_here
```

- [ ] **Step 4: 写失败的测试**

`src/types.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { cellKey } from './types'

describe('cellKey', () => {
  it('把起点与档位拼成稳定的键', () => {
    expect(cellKey('o1', 30)).toBe('o1@30')
  })

  it('不同档位产生不同的键', () => {
    expect(cellKey('o1', 15)).not.toBe(cellKey('o1', 30))
  })
})
```

- [ ] **Step 5: 运行测试确认失败**

Run: `npm test -- src/types.test.ts`
Expected: FAIL，报 `cellKey` 无法从 `./types` 导入

- [ ] **Step 6: 写类型定义**

`src/types.ts`：

```ts
export type Mode = 'transit' | 'driving' | 'walking' | 'cycling'

export type TransitPolicy = 'ALL' | 'SUBWAY' | 'BUS'

export type Origin = {
  id: string
  label: string
  lngLat: [number, number]
  mode: Mode
  policy: TransitPolicy
  thresholds: number[]
  color: string
  visible: boolean
}

/** 同档配对：档位全局共享；自定义：每点独立选一个档位 */
export type BandMode = 'paired' | 'custom'

export type SetOp = 'intersect' | 'union' | 'difference'

export const MAX_MINUTES = 60

export type CellKey = string

/** 一个起点在一个档位上的数据格，是请求与缓存的最小单位 */
export function cellKey(originId: string, minutes: number): CellKey {
  return `${originId}@${minutes}`
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test -- src/types.test.ts`
Expected: PASS，2 个测试通过

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "chore: 项目骨架、Vitest 配置与共享类型"
```

---

### Task 2: 几何运算层

**Files:**
- Create: `src/geometry/ops.ts`
- Test: `src/geometry/ops.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `SIMPLIFY_TOLERANCE`, `normalize(polys)`, `simplifyForOps(feature)`, `intersectAll(features)`, `unionAll(features)`, `differenceFrom(base, others)` —— 全部返回 `Feature<Polygon | MultiPolygon> | null`，`null` 表示结果为空

- [ ] **Step 1: 写失败的测试**

`src/geometry/ops.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { intersectAll, unionAll, differenceFrom, normalize } from './ops'

/** 生成一个以 (x, y) 为左下角、边长 size 的正方形 */
function square(x: number, y: number, size = 1) {
  return polygon([[
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ]])
}

describe('intersectAll', () => {
  it('两个重叠正方形返回重叠区域', () => {
    const result = intersectAll([square(0, 0, 2), square(1, 1, 2)])
    expect(result).not.toBeNull()
  })

  it('完全不相交时返回 null（空交集是有效结论）', () => {
    const result = intersectAll([square(0, 0), square(10, 10)])
    expect(result).toBeNull()
  })

  it('单个输入时交集等于自身', () => {
    const only = square(0, 0)
    const result = intersectAll([only])
    expect(result).not.toBeNull()
    expect(result!.geometry).toEqual(only.geometry)
  })

  it('三个图形中只要有一个不相交，整体即为空', () => {
    const result = intersectAll([square(0, 0, 2), square(1, 1, 2), square(50, 50)])
    expect(result).toBeNull()
  })

  it('空数组返回 null', () => {
    expect(intersectAll([])).toBeNull()
  })
})

describe('unionAll', () => {
  it('两个分离的图形合成一个 MultiPolygon', () => {
    const result = unionAll([square(0, 0), square(10, 10)])
    expect(result).not.toBeNull()
    expect(result!.geometry.type).toBe('MultiPolygon')
  })

  it('空数组返回 null', () => {
    expect(unionAll([])).toBeNull()
  })
})

describe('differenceFrom', () => {
  it('减去不相交的图形后基准保持非空', () => {
    const result = differenceFrom(square(0, 0), [square(10, 10)])
    expect(result).not.toBeNull()
  })

  it('被完全覆盖时返回 null（差集为空是有效结论）', () => {
    const result = differenceFrom(square(1, 1), [square(0, 0, 5)])
    expect(result).toBeNull()
  })

  it('没有其他图形可减时返回基准自身', () => {
    const base = square(0, 0)
    const result = differenceFrom(base, [])
    expect(result).not.toBeNull()
  })
})

describe('normalize', () => {
  it('把一组相互重叠的多边形并成无自交的单一要素', () => {
    const result = normalize([square(0, 0, 2), square(1, 0, 2), square(2, 0, 2)])
    expect(result).not.toBeNull()
    expect(result!.geometry.type).toBe('Polygon')
  })

  it('保留不连通的部分为 MultiPolygon', () => {
    const result = normalize([square(0, 0), square(10, 10)])
    expect(result!.geometry.type).toBe('MultiPolygon')
  })

  it('空输入返回 null', () => {
    expect(normalize([])).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/geometry/ops.test.ts`
Expected: FAIL，报 `./ops` 模块不存在

- [ ] **Step 3: 实现几何运算层**

`src/geometry/ops.ts`：

```ts
import { featureCollection, intersect, union, difference, simplify } from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'

export type PolyFeature = Feature<Polygon | MultiPolygon>

/** 约 10 米。等时圈本身精度远粗于此，简化不损失有效信息，但能把布尔运算量降一到两个数量级 */
export const SIMPLIFY_TOLERANCE = 0.0001

export function simplifyForOps(f: PolyFeature): PolyFeature {
  return simplify(f, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false }) as PolyFeature
}

/**
 * 把一组可能相互重叠、可能自相交的多边形并成一个规范要素。
 * Provider 出口必须调用它——高德返回的公交可达域是沿线路撒开的几十上百块重叠区域，
 * 不归一化直接做布尔运算会得到错误结果或卡死。
 */
export function normalize(polys: PolyFeature[]): PolyFeature | null {
  if (polys.length === 0) return null
  if (polys.length === 1) return polys[0]
  return (union(featureCollection(polys)) as PolyFeature | null) ?? null
}

export function unionAll(features: PolyFeature[]): PolyFeature | null {
  if (features.length === 0) return null
  if (features.length === 1) return features[0]
  return (union(featureCollection(features)) as PolyFeature | null) ?? null
}

/** 逐对求交。任一步为空则整体为空——这是正确的短路，不是提前退出的优化 */
export function intersectAll(features: PolyFeature[]): PolyFeature | null {
  if (features.length === 0) return null
  let acc: PolyFeature | null = features[0]
  for (let i = 1; i < features.length; i++) {
    if (acc === null) return null
    acc = (intersect(featureCollection([acc, features[i]])) as PolyFeature | null) ?? null
  }
  return acc
}

/** base \ (others[0] ∪ others[1] ∪ …)。Turf 7 的 difference 原生就是首项减去其余全部 */
export function differenceFrom(base: PolyFeature, others: PolyFeature[]): PolyFeature | null {
  if (others.length === 0) return base
  return (difference(featureCollection([base, ...others])) as PolyFeature | null) ?? null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/geometry/ops.test.ts`
Expected: PASS，13 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add src/geometry/
git commit -m "feat: 几何运算层，交集/并集/差集与归一化"
```

---

### Task 3: 面积计算与结果判定

**Files:**
- Create: `src/geometry/result.ts`
- Test: `src/geometry/result.test.ts`

**Interfaces:**
- Consumes: `PolyFeature`（Task 2）
- Produces: `BandResult` 类型、`formatArea(sqm)`、`resolveBandStatus(cells, requiredIds)`

- [ ] **Step 1: 写失败的测试**

`src/geometry/result.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { formatArea, resolveBandStatus, type CellStatus } from './result'

/** 显式标注元素类型——否则 TS 会把 Map 推断成 Map<string, string>，tsc --noEmit 报错 */
const cells = (...entries: Array<[string, CellStatus]>) => new Map<string, CellStatus>(entries)

describe('formatArea', () => {
  it('大面积用平方公里', () => {
    expect(formatArea(12_400_000)).toBe('12.40 km²')
  })

  it('小面积用平方米', () => {
    expect(formatArea(8500)).toBe('8500 m²')
  })

  it('零面积', () => {
    expect(formatArea(0)).toBe('0 m²')
  })
})

describe('resolveBandStatus', () => {
  it('全部就绪时可以运算', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'ok']), ['a', 'b'])
    expect(status).toEqual({ kind: 'ready' })
  })

  it('任一点失败则整档不可用，并列出缺失来源', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'error']), ['a', 'b'])
    expect(status).toEqual({ kind: 'unavailable', missing: ['b'] })
  })

  it('某点该档尚未请求，同样视为不可用', () => {
    const status = resolveBandStatus(cells(['a', 'ok']), ['a', 'b'])
    expect(status).toEqual({ kind: 'unavailable', missing: ['b'] })
  })

  it('仍在加载时报告 loading 而非 unavailable', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'loading']), ['a', 'b'])
    expect(status).toEqual({ kind: 'loading' })
  })

  it('某点无公交覆盖是有效数据，不阻断运算', () => {
    const status = resolveBandStatus(cells(['a', 'ok'], ['b', 'empty']), ['a', 'b'])
    expect(status).toEqual({ kind: 'ready' })
  })

  it('没有任何必需点时不可运算', () => {
    expect(resolveBandStatus(cells(), [])).toEqual({ kind: 'unavailable', missing: [] })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/geometry/result.test.ts`
Expected: FAIL，报 `./result` 模块不存在

- [ ] **Step 3: 实现**

`src/geometry/result.ts`：

```ts
import { area } from '@turf/turf'
import type { PolyFeature } from './ops'

export type CellStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error'

export type BandStatus =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; missing: string[] }

export type BandResult =
  | { kind: 'ok'; geometry: PolyFeature; areaSqM: number }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; missing: string[] }

export function areaOf(f: PolyFeature): number {
  return area(f)
}

export function formatArea(sqm: number): string {
  if (sqm >= 1_000_000) return `${(sqm / 1_000_000).toFixed(2)} km²`
  return `${Math.round(sqm)} m²`
}

/**
 * 决定某个档位能否参与集合运算。
 *
 * 关键规则：任一必需起点在该档为 error 或尚未有数据时，整档判为 unavailable。
 * 绝不能拿残缺的点集合去算交集——那会得出一个看起来完全正常、实则错误的结果。
 *
 * 注意 'empty'（该点周边无公交覆盖）是有效数据，不阻断运算：
 * 它参与交集会正确地导致空交集，这本身就是要传达的结论。
 */
export function resolveBandStatus(
  cells: Map<string, CellStatus>,
  requiredOriginIds: string[],
): BandStatus {
  if (requiredOriginIds.length === 0) return { kind: 'unavailable', missing: [] }

  const missing: string[] = []
  let loading = false

  for (const id of requiredOriginIds) {
    const status = cells.get(id)
    if (status === 'loading') loading = true
    else if (status !== 'ok' && status !== 'empty') missing.push(id)
  }

  if (missing.length > 0) return { kind: 'unavailable', missing }
  if (loading) return { kind: 'loading' }
  return { kind: 'ready' }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/geometry/result.test.ts`
Expected: PASS，9 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add src/geometry/
git commit -m "feat: 面积格式化与档位可用性判定"
```

---

### Task 4: 高德响应转换与归一化

**Files:**
- Create: `src/providers/transform.ts`
- Create: `src/providers/fixtures/arrival-range.json`
- Test: `src/providers/transform.test.ts`

**Interfaces:**
- Consumes: `normalize`（Task 2）
- Produces: `boundsToPolygons(bounds)`、`boundsToNormalizedFeature(bounds)`

- [ ] **Step 1: 造 fixture**

`src/providers/fixtures/arrival-range.json` —— 模拟 `AMap.ArrivalRange` 回调中 `result.bounds` 的形状：多个路径，每个是 `{lng, lat}` 数组，首尾**不**闭合（高德不闭合，GeoJSON 要求闭合，这正是转换要处理的）。故意让前两块重叠，用来验证归一化。

```json
{
  "bounds": [
    [
      {"lng": 116.30, "lat": 39.90},
      {"lng": 116.34, "lat": 39.90},
      {"lng": 116.34, "lat": 39.94},
      {"lng": 116.30, "lat": 39.94}
    ],
    [
      {"lng": 116.32, "lat": 39.92},
      {"lng": 116.36, "lat": 39.92},
      {"lng": 116.36, "lat": 39.96},
      {"lng": 116.32, "lat": 39.96}
    ],
    [
      {"lng": 116.50, "lat": 39.80},
      {"lng": 116.52, "lat": 39.80},
      {"lng": 116.52, "lat": 39.82},
      {"lng": 116.50, "lat": 39.82}
    ]
  ]
}
```

- [ ] **Step 2: 写失败的测试**

`src/providers/transform.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { kinks } from '@turf/turf'
import { boundsToPolygons, boundsToNormalizedFeature } from './transform'
import fixture from './fixtures/arrival-range.json'

describe('boundsToPolygons', () => {
  it('把每条路径转成一个 Polygon', () => {
    const polys = boundsToPolygons(fixture.bounds)
    expect(polys).toHaveLength(3)
  })

  it('闭合环——高德不闭合，GeoJSON 必须闭合', () => {
    const polys = boundsToPolygons(fixture.bounds)
    const ring = polys[0].geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('丢弃点数不足以成面的路径', () => {
    const polys = boundsToPolygons([[{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }]])
    expect(polys).toHaveLength(0)
  })

  it('空 bounds 得到空数组（该点无公交覆盖）', () => {
    expect(boundsToPolygons([])).toHaveLength(0)
  })
})

describe('boundsToNormalizedFeature', () => {
  it('把重叠的分块并成无自交的要素', () => {
    const f = boundsToNormalizedFeature(fixture.bounds)
    expect(f).not.toBeNull()
    expect(kinks(f!).features).toHaveLength(0)
  })

  it('保留不连通的远处分块', () => {
    const f = boundsToNormalizedFeature(fixture.bounds)
    expect(f!.geometry.type).toBe('MultiPolygon')
  })

  it('空 bounds 返回 null', () => {
    expect(boundsToNormalizedFeature([])).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/providers/transform.test.ts`
Expected: FAIL，报 `./transform` 模块不存在

- [ ] **Step 4: 实现转换**

`src/providers/transform.ts`：

```ts
import { polygon } from '@turf/turf'
import { normalize, type PolyFeature } from '../geometry/ops'

/** 高德回调里 result.bounds 的元素形状 */
export type AmapPath = Array<{ lng: number; lat: number }>

/**
 * 一条路径转一个 Polygon。
 * 高德的路径不闭合，GeoJSON 的环必须首尾相同，这里补上。
 */
export function boundsToPolygons(bounds: AmapPath[]): PolyFeature[] {
  const out: PolyFeature[] = []
  for (const path of bounds) {
    if (!path || path.length < 3) continue
    const ring: [number, number][] = path.map((p) => [p.lng, p.lat])
    const [fx, fy] = ring[0]
    const [lx, ly] = ring[ring.length - 1]
    if (fx !== lx || fy !== ly) ring.push([fx, fy])
    out.push(polygon([ring]) as PolyFeature)
  }
  return out
}

/**
 * Provider 出口的契约：无论高德返回多少块重叠区域，
 * 下游拿到的永远是一个干净、无自交的规范要素（或 null 表示无覆盖）。
 */
export function boundsToNormalizedFeature(bounds: AmapPath[]): PolyFeature | null {
  return normalize(boundsToPolygons(bounds))
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/providers/transform.test.ts`
Expected: PASS，7 个测试全部通过

- [ ] **Step 6: 提交**

```bash
git add src/providers/
git commit -m "feat: 高德 bounds 到规范 GeoJSON 的转换与归一化"
```

---

### Task 5: 参数指纹缓存

**Files:**
- Create: `src/providers/cache.ts`
- Test: `src/providers/cache.test.ts`

**Interfaces:**
- Consumes: `IsochroneRequest`（本任务定义）
- Produces: `IsochroneRequest`、`IsochroneProvider`、`requestFingerprint(providerId, req)`、`withCache(provider)`

- [ ] **Step 1: 写失败的测试**

`src/providers/cache.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { polygon } from '@turf/turf'
import { requestFingerprint, withCache } from './cache'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

const req = (over: Partial<IsochroneRequest> = {}): IsochroneRequest => ({
  lngLat: [116.397, 39.909],
  mode: 'transit',
  minutes: 30,
  policy: 'ALL',
  ...over,
})

function fakeProvider(): IsochroneProvider & { calls: number } {
  const p = {
    id: 'fake',
    supportedModes: ['transit'] as const,
    calls: 0,
    async fetch() {
      p.calls++
      return shape
    },
  }
  return p as unknown as IsochroneProvider & { calls: number }
}

describe('requestFingerprint', () => {
  it('相同参数得到相同指纹', () => {
    expect(requestFingerprint('amap', req())).toBe(requestFingerprint('amap', req()))
  })

  it('档位不同则指纹不同', () => {
    expect(requestFingerprint('amap', req())).not.toBe(
      requestFingerprint('amap', req({ minutes: 45 })),
    )
  })

  it('策略不同则指纹不同', () => {
    expect(requestFingerprint('amap', req())).not.toBe(
      requestFingerprint('amap', req({ policy: 'SUBWAY' })),
    )
  })

  it('坐标取到 5 位小数，抖动不影响命中', () => {
    expect(requestFingerprint('amap', req({ lngLat: [116.3970001, 39.9090001] })))
      .toBe(requestFingerprint('amap', req()))
  })
})

describe('withCache', () => {
  it('相同请求只打一次后端', async () => {
    const inner = fakeProvider()
    const cached = withCache(inner)
    await cached.fetch(req())
    await cached.fetch(req())
    expect(inner.calls).toBe(1)
  })

  it('不同档位分别请求', async () => {
    const inner = fakeProvider()
    const cached = withCache(inner)
    await cached.fetch(req())
    await cached.fetch(req({ minutes: 45 }))
    expect(inner.calls).toBe(2)
  })

  it('并发的相同请求合并成一次（防抖同飞）', async () => {
    const inner = fakeProvider()
    const cached = withCache(inner)
    await Promise.all([cached.fetch(req()), cached.fetch(req())])
    expect(inner.calls).toBe(1)
  })

  it('失败的请求不写入缓存，可以重试', async () => {
    let n = 0
    const flaky: IsochroneProvider = {
      id: 'flaky',
      supportedModes: ['transit'],
      async fetch() {
        n++
        if (n === 1) throw new Error('boom')
        return shape
      },
    }
    const cached = withCache(flaky)
    await expect(cached.fetch(req())).rejects.toThrow('boom')
    await expect(cached.fetch(req())).resolves.not.toBeNull()
    expect(n).toBe(2)
  })

  it('null 结果（无公交覆盖）会被缓存', async () => {
    let n = 0
    const emptyProvider: IsochroneProvider = {
      id: 'empty',
      supportedModes: ['transit'],
      async fetch() {
        n++
        return null
      },
    }
    const cached = withCache(emptyProvider)
    await cached.fetch(req())
    await cached.fetch(req())
    expect(n).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/providers/cache.test.ts`
Expected: FAIL，报 `./cache` 模块不存在

- [ ] **Step 3: 实现缓存**

`src/providers/cache.ts`：

```ts
import type { Mode, TransitPolicy } from '../types'
import type { PolyFeature } from '../geometry/ops'

export type IsochroneRequest = {
  lngLat: [number, number]
  mode: Mode
  minutes: number
  policy?: TransitPolicy
}

export interface IsochroneProvider {
  id: string
  supportedModes: readonly Mode[]
  /** null 表示该点周边无可达数据——这是有效结果，不是错误 */
  fetch(req: IsochroneRequest): Promise<PolyFeature | null>
}

export function requestFingerprint(providerId: string, req: IsochroneRequest): string {
  const [lng, lat] = req.lngLat
  return [
    providerId,
    `${lng.toFixed(5)},${lat.toFixed(5)}`,
    req.mode,
    req.policy ?? 'ALL',
    req.minutes,
  ].join('|')
}

/**
 * 参数指纹缓存。它带来三个直接结果：
 *   切换交集/并集/差集 零请求；点拖走再拖回 零请求；新增一个档位 只请求那一档。
 * 同时合并在飞的相同请求，避免重复点击打出两份。
 */
export function withCache(inner: IsochroneProvider): IsochroneProvider {
  const done = new Map<string, PolyFeature | null>()
  const inFlight = new Map<string, Promise<PolyFeature | null>>()

  return {
    id: inner.id,
    supportedModes: inner.supportedModes,
    async fetch(req) {
      const key = requestFingerprint(inner.id, req)
      if (done.has(key)) return done.get(key)!

      const flying = inFlight.get(key)
      if (flying) return flying

      const p = inner.fetch(req)
        .then((result) => {
          done.set(key, result)
          return result
        })
        .finally(() => {
          inFlight.delete(key)
        })

      inFlight.set(key, p)
      return p
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/providers/cache.test.ts`
Expected: PASS，10 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add src/providers/
git commit -m "feat: provider 参数指纹缓存与在飞请求合并"
```

---

### Task 6: 并发闸门与退避重试

**Files:**
- Create: `src/providers/gate.ts`
- Test: `src/providers/gate.test.ts`

**Interfaces:**
- Consumes: `IsochroneProvider`（Task 5）
- Produces: `MAX_CONCURRENCY`、`withGate(provider, opts?)`

- [ ] **Step 1: 写失败的测试**

`src/providers/gate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { withGate, MAX_CONCURRENCY } from './gate'
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

const req = (minutes: number): IsochroneRequest => ({
  lngLat: [116.397, 39.909],
  mode: 'transit',
  minutes,
  policy: 'ALL',
})

describe('withGate', () => {
  it('同时在飞的请求不超过上限', async () => {
    let active = 0
    let peak = 0
    const slow: IsochroneProvider = {
      id: 'slow',
      supportedModes: ['transit'],
      async fetch() {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
        return shape
      },
    }
    const gated = withGate(slow)
    await Promise.all(Array.from({ length: 12 }, (_, i) => gated.fetch(req(i))))
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY)
  })

  it('所有请求最终都完成', async () => {
    const p: IsochroneProvider = {
      id: 'p',
      supportedModes: ['transit'],
      async fetch() { return shape },
    }
    const gated = withGate(p)
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => gated.fetch(req(i))))
    expect(results).toHaveLength(12)
    expect(results.every((r) => r !== null)).toBe(true)
  })

  it('失败后按退避重试并最终成功', async () => {
    let n = 0
    const flaky: IsochroneProvider = {
      id: 'flaky',
      supportedModes: ['transit'],
      async fetch() {
        n++
        if (n < 3) throw new Error('QPS 超限')
        return shape
      },
    }
    const gated = withGate(flaky, { retries: 3, baseDelayMs: 1 })
    await expect(gated.fetch(req(30))).resolves.not.toBeNull()
    expect(n).toBe(3)
  })

  it('重试用尽后抛出最后一次的错误', async () => {
    const broken: IsochroneProvider = {
      id: 'broken',
      supportedModes: ['transit'],
      async fetch() { throw new Error('一直失败') },
    }
    const gated = withGate(broken, { retries: 2, baseDelayMs: 1 })
    await expect(gated.fetch(req(30))).rejects.toThrow('一直失败')
  })

  it('一个请求失败不会卡住闸门', async () => {
    let n = 0
    const mixed: IsochroneProvider = {
      id: 'mixed',
      supportedModes: ['transit'],
      async fetch() {
        n++
        if (n === 1) throw new Error('第一个失败')
        return shape
      },
    }
    const gated = withGate(mixed, { retries: 0, baseDelayMs: 1 })
    const results = await Promise.allSettled([
      gated.fetch(req(15)), gated.fetch(req(30)), gated.fetch(req(45)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/providers/gate.test.ts`
Expected: FAIL，报 `./gate` 模块不存在

- [ ] **Step 3: 实现闸门**

`src/providers/gate.ts`：

```ts
import type { IsochroneProvider, IsochroneRequest } from './cache'
import type { PolyFeature } from '../geometry/ops'

/**
 * ArrivalRange 一次只能处理一个起点一个档位，请求数是「点数 × 档位数」。
 * 3 点 × 4 档就是 12 个并发，足以触发高德的 QPS 限制。
 * 不加闸门会随机丢圈——这是正确性问题，不是性能优化。
 */
export const MAX_CONCURRENCY = 4

type GateOptions = { retries?: number; baseDelayMs?: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function withGate(inner: IsochroneProvider, opts: GateOptions = {}): IsochroneProvider {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 400

  let active = 0
  const waiting: Array<() => void> = []

  async function acquire(): Promise<void> {
    if (active < MAX_CONCURRENCY) {
      active++
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
    active++
  }

  function release(): void {
    active--
    const next = waiting.shift()
    if (next) next()
  }

  async function attempt(req: IsochroneRequest): Promise<PolyFeature | null> {
    let lastError: unknown
    for (let i = 0; i <= retries; i++) {
      try {
        return await inner.fetch(req)
      } catch (err) {
        lastError = err
        if (i < retries) await sleep(baseDelayMs * 2 ** i)
      }
    }
    throw lastError
  }

  return {
    id: inner.id,
    supportedModes: inner.supportedModes,
    async fetch(req) {
      await acquire()
      try {
        return await attempt(req)
      } finally {
        release()
      }
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/providers/gate.test.ts`
Expected: PASS，5 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add src/providers/
git commit -m "feat: 并发闸门与指数退避重试"
```

---

### Task 7: 高德 provider 与 JS API 加载

**Files:**
- Create: `src/amap/loader.ts`
- Create: `src/providers/amapTransit.ts`
- Create: `src/providers/index.ts`

**Interfaces:**
- Consumes: `boundsToNormalizedFeature`（Task 4）、`withCache`（Task 5）、`withGate`（Task 6）
- Produces: `loadAmap()`、`AmapKeyMissingError`、`createAmapTransitProvider()`、`getProvider()`

本任务没有单元测试——它是对浏览器全局 `AMap` 的薄封装，可测的逻辑已经全部抽到 Task 4 的 `transform.ts` 里了。为外部地图 SDK 搭 mock 的收益低于成本。

- [ ] **Step 1: 写 JS API 加载器**

`src/amap/loader.ts`：

```ts
import AMapLoader from '@amap/amap-jsapi-loader'

export class AmapKeyMissingError extends Error {
  constructor() {
    super('未配置高德 Key。请复制 .env.example 为 .env 并填入 VITE_AMAP_KEY。')
    this.name = 'AmapKeyMissingError'
  }
}

let loading: Promise<typeof AMap> | null = null

export function loadAmap(): Promise<typeof AMap> {
  if (loading) return loading

  const key = import.meta.env.VITE_AMAP_KEY
  if (!key) return Promise.reject(new AmapKeyMissingError())

  loading = AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.ArrivalRange', 'AMap.PlaceSearch', 'AMap.Geocoder'],
  })
  return loading
}
```

- [ ] **Step 2: 写高德 provider**

`src/providers/amapTransit.ts`：

```ts
import { loadAmap } from '../amap/loader'
import { boundsToNormalizedFeature, type AmapPath } from './transform'
import type { IsochroneProvider } from './cache'
import { MAX_MINUTES } from '../types'

/**
 * 高德到达圈 provider。这是全代码库唯一知道高德存在的地方——
 * 它对外只吐规范 GeoJSON，几何层与 UI 层不感知数据来源。
 */
export function createAmapTransitProvider(): IsochroneProvider {
  return {
    id: 'amap-transit',
    supportedModes: ['transit'],

    async fetch(req) {
      if (req.mode !== 'transit') {
        throw new Error(`高德到达圈只支持公交，收到：${req.mode}`)
      }
      if (req.minutes > MAX_MINUTES) {
        throw new Error(`时间档位超过上限 ${MAX_MINUTES} 分钟`)
      }

      const AMapNS = await loadAmap()
      const arrivalRange = new (AMapNS as any).ArrivalRange()

      // 'ALL' 对应高德的缺省值：公交 + 地铁
      const policy = req.policy && req.policy !== 'ALL' ? { policy: req.policy } : {}

      const bounds = await new Promise<AmapPath[]>((resolve, reject) => {
        arrivalRange.search(
          req.lngLat,
          req.minutes,
          (status: string, result: { bounds?: AmapPath[]; info?: string }) => {
            if (status === 'complete') resolve(result.bounds ?? [])
            else reject(new Error(`高德到达圈请求失败：${result?.info ?? status}`))
          },
          policy,
        )
      })

      // 空 bounds 表示该点周边无公交可达数据——有效结果，不是错误
      return boundsToNormalizedFeature(bounds)
    },
  }
}
```

- [ ] **Step 3: 组装管线**

`src/providers/index.ts`：

```ts
import { createAmapTransitProvider } from './amapTransit'
import { withCache } from './cache'
import { withGate } from './gate'
import type { IsochroneProvider } from './cache'

export type { IsochroneProvider, IsochroneRequest } from './cache'

let provider: IsochroneProvider | null = null

/** 顺序有意义：缓存在外，命中缓存的请求根本不占用闸门名额 */
export function getProvider(): IsochroneProvider {
  if (!provider) provider = withCache(withGate(createAmapTransitProvider()))
  return provider
}
```

- [ ] **Step 4: 确认整体编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 5: 提交**

```bash
git add src/amap/ src/providers/
git commit -m "feat: 高德到达圈 provider 与管线组装"
```

---

### Task 8: 状态 store 与计算编排

**Files:**
- Create: `src/state/store.ts`
- Create: `src/state/compute.ts`
- Test: `src/state/compute.test.ts`

**Interfaces:**
- Consumes: `Origin` / `BandMode` / `SetOp` / `cellKey`（Task 1）、`intersectAll` / `unionAll` / `differenceFrom` / `simplifyForOps`（Task 2）、`resolveBandStatus` / `areaOf` / `BandResult` / `CellStatus`（Task 3）
- Produces: `planRequests(origins, bandMode, globalThresholds)`、`computeBand(...)`、`useStore`

- [ ] **Step 1: 写失败的测试**

`src/state/compute.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { planRequests, computeBand } from './compute'
import type { Origin } from '../types'
import type { PolyFeature } from '../geometry/ops'

function square(x: number, y: number, size = 1): PolyFeature {
  return polygon([[
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ]]) as PolyFeature
}

const origin = (id: string, over: Partial<Origin> = {}): Origin => ({
  id,
  label: id,
  lngLat: [116.397, 39.909],
  mode: 'transit',
  policy: 'ALL',
  thresholds: [30],
  color: '#e4572e',
  visible: true,
  ...over,
})

describe('planRequests', () => {
  it('同档模式下每点都用全局档位', () => {
    const plan = planRequests([origin('a'), origin('b')], 'paired', [15, 30])
    expect(plan).toHaveLength(4)
    expect(plan.map((p) => p.minutes).sort()).toEqual([15, 15, 30, 30])
  })

  it('自定义模式下每点用自己的档位', () => {
    const plan = planRequests(
      [origin('a', { thresholds: [15] }), origin('b', { thresholds: [45] })],
      'custom',
      [30],
    )
    expect(plan.map((p) => p.minutes).sort()).toEqual([15, 45])
  })

  it('跳过隐藏的起点', () => {
    const plan = planRequests([origin('a'), origin('b', { visible: false })], 'paired', [30])
    expect(plan).toHaveLength(1)
    expect(plan[0].originId).toBe('a')
  })

  it('去掉超过 60 分钟上限的档位', () => {
    const plan = planRequests([origin('a')], 'paired', [30, 90])
    expect(plan.map((p) => p.minutes)).toEqual([30])
  })

  it('没有可见起点时得到空计划', () => {
    expect(planRequests([origin('a', { visible: false })], 'paired', [30])).toHaveLength(0)
  })
})

describe('computeBand', () => {
  const geoms = new Map<string, PolyFeature | null>([
    ['a@30', square(0, 0, 2)],
    ['b@30', square(1, 1, 2)],
  ])
  const okCells = new Map([['a@30', 'ok' as const], ['b@30', 'ok' as const]])

  it('交集重叠时返回带面积的结果', () => {
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms, baseOriginId: null,
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.areaSqM).toBeGreaterThan(0)
  })

  it('交集为空时返回 empty 而非错误', () => {
    const far = new Map<string, PolyFeature | null>([
      ['a@30', square(0, 0)], ['b@30', square(50, 50)],
    ])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms: far, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'empty' })
  })

  it('某点该档失败时整档不可用，且不用残缺点集运算', () => {
    const broken = new Map([['a@30', 'ok' as const], ['b@30', 'error' as const]])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: broken, geoms, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'unavailable', missing: ['b'] })
  })

  it('某点无公交覆盖时，交集正确地为空', () => {
    const withEmpty = new Map([['a@30', 'ok' as const], ['b@30', 'empty' as const]])
    const geomsWithNull = new Map<string, PolyFeature | null>([
      ['a@30', square(0, 0, 2)], ['b@30', null],
    ])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: withEmpty, geoms: geomsWithNull, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'empty' })
  })

  it('并集在某点无覆盖时仍返回另一点的范围', () => {
    const withEmpty = new Map([['a@30', 'ok' as const], ['b@30', 'empty' as const]])
    const geomsWithNull = new Map<string, PolyFeature | null>([
      ['a@30', square(0, 0, 2)], ['b@30', null],
    ])
    const r = computeBand({
      op: 'union', minutes: 30, originIds: ['a', 'b'],
      cells: withEmpty, geoms: geomsWithNull, baseOriginId: null,
    })
    expect(r.kind).toBe('ok')
  })

  it('差集用指定的基准点', () => {
    const r = computeBand({
      op: 'difference', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms, baseOriginId: 'a',
    })
    expect(r.kind).toBe('ok')
  })

  it('差集缺少基准点时不可用', () => {
    const r = computeBand({
      op: 'difference', minutes: 30, originIds: ['a', 'b'],
      cells: okCells, geoms, baseOriginId: null,
    })
    expect(r.kind).toBe('unavailable')
  })

  it('仍在加载时返回 loading', () => {
    const loading = new Map([['a@30', 'ok' as const], ['b@30', 'loading' as const]])
    const r = computeBand({
      op: 'intersect', minutes: 30, originIds: ['a', 'b'],
      cells: loading, geoms, baseOriginId: null,
    })
    expect(r).toEqual({ kind: 'loading' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/state/compute.test.ts`
Expected: FAIL，报 `./compute` 模块不存在

- [ ] **Step 3: 实现编排逻辑**

`src/state/compute.ts`：

```ts
import { cellKey, MAX_MINUTES, type BandMode, type Origin, type SetOp } from '../types'
import {
  differenceFrom, intersectAll, simplifyForOps, unionAll, type PolyFeature,
} from '../geometry/ops'
import { areaOf, resolveBandStatus, type BandResult, type CellStatus } from '../geometry/result'

export type PlannedRequest = {
  originId: string
  minutes: number
  lngLat: [number, number]
  mode: Origin['mode']
  policy: Origin['policy']
}

/** 把当前状态摊平成「点 × 档位」的请求矩阵。隐藏的点与超限的档位在这里被剔除 */
export function planRequests(
  origins: Origin[],
  bandMode: BandMode,
  globalThresholds: number[],
): PlannedRequest[] {
  const out: PlannedRequest[] = []
  for (const o of origins) {
    if (!o.visible) continue
    const thresholds = bandMode === 'paired' ? globalThresholds : o.thresholds
    for (const minutes of thresholds) {
      if (minutes <= 0 || minutes > MAX_MINUTES) continue
      out.push({
        originId: o.id, minutes, lngLat: o.lngLat, mode: o.mode, policy: o.policy,
      })
    }
  }
  return out
}

export type ComputeBandInput = {
  op: SetOp
  minutes: number
  originIds: string[]
  cells: Map<string, CellStatus>
  geoms: Map<string, PolyFeature | null>
  baseOriginId: string | null
}

export function computeBand(input: ComputeBandInput): BandResult {
  const { op, minutes, originIds, cells, geoms, baseOriginId } = input

  // 把「点 × 档」的格状态投影成该档内的「点 → 状态」，再判定整档是否可运算
  const bandCells = new Map<string, CellStatus>()
  for (const id of originIds) {
    const status = cells.get(cellKey(id, minutes))
    if (status) bandCells.set(id, status)
  }

  const status = resolveBandStatus(bandCells, originIds)
  if (status.kind !== 'ready') return status

  const present: PolyFeature[] = []
  const byOrigin = new Map<string, PolyFeature>()
  for (const id of originIds) {
    const g = geoms.get(cellKey(id, minutes))
    if (g) {
      const s = simplifyForOps(g)
      present.push(s)
      byOrigin.set(id, s)
    }
  }

  let result: PolyFeature | null = null

  if (op === 'intersect') {
    // 有点无覆盖（几何为 null）时，交集必然为空——这是正确结论，不是缺数据
    result = present.length === originIds.length ? intersectAll(present) : null
  } else if (op === 'union') {
    result = unionAll(present)
  } else {
    if (!baseOriginId) return { kind: 'unavailable', missing: [] }
    const base = byOrigin.get(baseOriginId)
    if (!base) return { kind: 'empty' }
    const others = originIds
      .filter((id) => id !== baseOriginId)
      .map((id) => byOrigin.get(id))
      .filter((g): g is PolyFeature => Boolean(g))
    result = differenceFrom(base, others)
  }

  if (!result) return { kind: 'empty' }
  return { kind: 'ok', geometry: result, areaSqM: areaOf(result) }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/state/compute.test.ts`
Expected: PASS，14 个测试全部通过

- [ ] **Step 5: 写 store**

`src/state/store.ts`：

```ts
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
    const id = `o${Date.now().toString(36)}`
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
```

- [ ] **Step 6: 确认编译通过并跑全部测试**

Run: `npx tsc --noEmit && npm test`
Expected: 编译无错，全部测试通过

- [ ] **Step 7: 提交**

```bash
git add src/state/
git commit -m "feat: 状态 store 与档位计算编排"
```

---

### Task 9: 地图组件

**Files:**
- Create: `src/components/MapView.tsx`
- Create: `src/components/MapView.css`

**Interfaces:**
- Consumes: `loadAmap`（Task 7）、`useStore`（Task 8）、`computeBand`（Task 8）
- Produces: `<MapView />`

- [ ] **Step 1: 写地图组件**

`src/components/MapView.tsx`：

```tsx
import { useEffect, useRef } from 'react'
import { loadAmap } from '../amap/loader'
import { useStore } from '../state/store'
import { cellKey } from '../types'
import { computeBand } from '../state/compute'
import type { PolyFeature } from '../geometry/ops'
import './MapView.css'

/** GeoJSON 环 → 高德 path。坐标已经是 GCJ-02，直接用 */
function ringsOf(f: PolyFeature): number[][][] {
  return f.geometry.type === 'Polygon'
    ? [f.geometry.coordinates[0] as number[][]]
    : (f.geometry.coordinates as number[][][][]).map((poly) => poly[0] as number[][])
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const originLayerRef = useRef<any[]>([])
  const resultLayerRef = useRef<any[]>([])
  const markerRef = useRef<any[]>([])

  const origins = useStore((s) => s.origins)
  const cells = useStore((s) => s.cells)
  const geoms = useStore((s) => s.geoms)
  const op = useStore((s) => s.op)
  const bandMode = useStore((s) => s.bandMode)
  const globalThresholds = useStore((s) => s.globalThresholds)
  const baseOriginId = useStore((s) => s.baseOriginId)
  const addOrigin = useStore((s) => s.addOrigin)
  const updateOrigin = useStore((s) => s.updateOrigin)
  const setFatalError = useStore((s) => s.setFatalError)

  // 建图，只做一次
  useEffect(() => {
    let disposed = false
    loadAmap()
      .then((AMapNS) => {
        if (disposed || !containerRef.current) return
        const map = new AMapNS.Map(containerRef.current, {
          zoom: 11,
          center: [116.397, 39.909],
          viewMode: '2D',
        })
        map.on('click', (e: any) => addOrigin([e.lnglat.getLng(), e.lnglat.getLat()], ''))
        mapRef.current = map
      })
      .catch((err) => setFatalError(err instanceof Error ? err.message : String(err)))
    return () => {
      disposed = true
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [addOrigin, setFatalError])

  // 起点标记，可拖拽；dragend 才触发重算，dragging 不触发
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current.forEach((m) => map.remove(m))
    markerRef.current = origins.map((o) => {
      const marker = new (window as any).AMap.Marker({
        position: o.lngLat,
        draggable: true,
        title: o.label,
      })
      marker.on('dragend', (e: any) => {
        updateOrigin(o.id, { lngLat: [e.lnglat.getLng(), e.lnglat.getLat()] })
      })
      map.add(marker)
      return marker
    })
  }, [origins, updateOrigin])

  // 各点原始等时圈：半透明铺底
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    originLayerRef.current.forEach((p) => map.remove(p))
    originLayerRef.current = []

    for (const o of origins) {
      if (!o.visible) continue
      const thresholds = bandMode === 'paired' ? globalThresholds : o.thresholds
      for (const minutes of thresholds) {
        const geom = geoms.get(cellKey(o.id, minutes))
        if (!geom) continue
        for (const ring of ringsOf(geom)) {
          const poly = new (window as any).AMap.Polygon({
            path: ring,
            fillColor: o.color,
            fillOpacity: 0.12,
            strokeColor: o.color,
            strokeOpacity: 0.5,
            strokeWeight: 1,
          })
          map.add(poly)
          originLayerRef.current.push(poly)
        }
      }
    }
  }, [origins, geoms, bandMode, globalThresholds])

  // 运算结果：高对比压在最上层
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    resultLayerRef.current.forEach((p) => map.remove(p))
    resultLayerRef.current = []

    const visibleIds = origins.filter((o) => o.visible).map((o) => o.id)
    if (visibleIds.length < 2) return
    const bands = bandMode === 'paired' ? globalThresholds : [globalThresholds[0]]

    for (const minutes of bands) {
      const r = computeBand({ op, minutes, originIds: visibleIds, cells, geoms, baseOriginId })
      if (r.kind !== 'ok') continue
      for (const ring of ringsOf(r.geometry)) {
        const poly = new (window as any).AMap.Polygon({
          path: ring,
          fillColor: '#111827',
          fillOpacity: 0.3,
          strokeColor: '#f59e0b',
          strokeWeight: 3,
          zIndex: 100,
        })
        map.add(poly)
        resultLayerRef.current.push(poly)
      }
    }
  }, [origins, cells, geoms, op, bandMode, globalThresholds, baseOriginId])

  return <div className="map-view" ref={containerRef} />
}
```

- [ ] **Step 2: 写样式**

`src/components/MapView.css`：

```css
.map-view {
  flex: 1;
  height: 100%;
  min-width: 0;
}
```

- [ ] **Step 3: 确认编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 4: 提交**

```bash
git add src/components/
git commit -m "feat: 地图组件，等时圈与结果分层渲染"
```

---

### Task 10: 侧栏、搜索加点与导出

**Files:**
- Create: `src/components/Sidebar.tsx`, `src/components/Sidebar.css`
- Create: `src/components/SearchBox.tsx`
- Create: `src/export.ts`
- Modify: `src/App.tsx`, `src/main.tsx`
- Test: `src/export.test.ts`

**Interfaces:**
- Consumes: `useStore`（Task 8）、`computeBand` / `formatArea`（Task 3、8）、`loadAmap`（Task 7）
- Produces: `<Sidebar />`、`<SearchBox />`、`toGeoJSONBlob(features)`

- [ ] **Step 1: 写导出的失败测试**

`src/export.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { polygon } from '@turf/turf'
import { buildExportCollection } from './export'
import type { PolyFeature } from './geometry/ops'

const shape = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) as PolyFeature

describe('buildExportCollection', () => {
  it('打包成 FeatureCollection', () => {
    const fc = buildExportCollection([{ minutes: 30, feature: shape }])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1)
  })

  it('把档位写进 properties', () => {
    const fc = buildExportCollection([{ minutes: 30, feature: shape }])
    expect(fc.features[0].properties?.minutes).toBe(30)
  })

  it('标注坐标系为 GCJ-02，避免下游误当 WGS-84 用', () => {
    const fc = buildExportCollection([{ minutes: 30, feature: shape }])
    expect(fc.features[0].properties?.crs).toBe('GCJ-02')
  })

  it('空输入得到空集合', () => {
    expect(buildExportCollection([]).features).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/export.test.ts`
Expected: FAIL，报 `./export` 模块不存在

- [ ] **Step 3: 实现导出**

`src/export.ts`：

```ts
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import type { PolyFeature } from './geometry/ops'

export type ExportItem = { minutes: number; feature: PolyFeature }

export function buildExportCollection(
  items: ExportItem[],
): FeatureCollection<Polygon | MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: items.map((it) => ({
      ...it.feature,
      properties: { ...it.feature.properties, minutes: it.minutes, crs: 'GCJ-02' },
    })),
  }
}

export function downloadGeoJSON(items: ExportItem[], filename = 'isochrone-result.geojson'): void {
  const blob = new Blob([JSON.stringify(buildExportCollection(items), null, 2)], {
    type: 'application/geo+json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/export.test.ts`
Expected: PASS，4 个测试通过

- [ ] **Step 5: 写搜索框**

`src/components/SearchBox.tsx`：

```tsx
import { useState } from 'react'
import { loadAmap } from '../amap/loader'
import { useStore } from '../state/store'

export function SearchBox() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const addOrigin = useStore((s) => s.addOrigin)

  async function search() {
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const AMapNS = await loadAmap()
      const ps = new (AMapNS as any).PlaceSearch({ pageSize: 1 })
      const poi = await new Promise<any>((resolve, reject) => {
        ps.search(q, (status: string, result: any) => {
          if (status === 'complete' && result.poiList?.pois?.length) {
            resolve(result.poiList.pois[0])
          } else {
            reject(new Error('没有找到这个地点'))
          }
        })
      })
      addOrigin([poi.location.lng, poi.location.lat], poi.name)
      setQ('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="search-box">
      <input
        value={q}
        placeholder="搜地点加点，如「西二旗地铁站」"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
      />
      <button onClick={() => void search()} disabled={busy}>
        {busy ? '搜索中' : '添加'}
      </button>
      {err && <p className="hint error">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 6: 写侧栏**

`src/components/Sidebar.tsx`：

```tsx
import { SearchBox } from './SearchBox'
import { useStore } from '../state/store'
import { computeBand } from '../state/compute'
import { formatArea } from '../geometry/result'
import { downloadGeoJSON, type ExportItem } from '../export'
import { cellKey, MAX_MINUTES, type SetOp, type TransitPolicy } from '../types'
import './Sidebar.css'

const OP_LABEL: Record<SetOp, string> = {
  intersect: '∩ 交集', union: '∪ 并集', difference: '− 差集',
}
const POLICY_LABEL: Record<TransitPolicy, string> = {
  ALL: '公交+地铁', SUBWAY: '只坐地铁', BUS: '只坐公交',
}
const EMPTY_TEXT: Record<SetOp, string> = {
  intersect: '无共同可达区',
  union: '无可达区域',
  difference: '基准点范围已被完全覆盖',
}

export function Sidebar() {
  const s = useStore()
  const visible = s.origins.filter((o) => o.visible)
  const visibleIds = visible.map((o) => o.id)
  const bands = s.bandMode === 'paired' ? s.globalThresholds : [s.globalThresholds[0]]

  const results = bands.map((minutes) => ({
    minutes,
    result: computeBand({
      op: s.op, minutes, originIds: visibleIds,
      cells: s.cells, geoms: s.geoms, baseOriginId: s.baseOriginId,
    }),
  }))

  const exportable: ExportItem[] = results
    .filter((r) => r.result.kind === 'ok')
    .map((r) => ({ minutes: r.minutes, feature: (r.result as any).geometry }))

  const nameOf = (id: string) => s.origins.find((o) => o.id === id)?.label ?? id

  return (
    <aside className="sidebar">
      <section className="pane origins">
        <h2>起点</h2>
        <SearchBox />
        {s.origins.length === 0 && <p className="hint">在地图上点击，或搜索地点来添加起点</p>}

        {s.origins.map((o) => (
          <div className="origin-card" key={o.id} style={{ borderLeftColor: o.color }}>
            <header>
              <input
                className="label-input"
                value={o.label}
                onChange={(e) => s.updateOrigin(o.id, { label: e.target.value })}
              />
              <button className="icon" title="删除" onClick={() => s.removeOrigin(o.id)}>×</button>
            </header>

            <label className="row">
              <input
                type="checkbox"
                checked={o.visible}
                onChange={(e) => s.updateOrigin(o.id, { visible: e.target.checked })}
              />
              参与运算
            </label>

            <select
              value={o.policy}
              onChange={(e) => s.setPolicy(o.id, e.target.value as TransitPolicy)}
            >
              {(Object.keys(POLICY_LABEL) as TransitPolicy[]).map((p) => (
                <option key={p} value={p}>{POLICY_LABEL[p]}</option>
              ))}
            </select>

            {s.bandMode === 'custom' && (
              <div className="chips">
                {[15, 30, 45, 60].map((m) => (
                  <button
                    key={m}
                    className={o.thresholds.includes(m) ? 'chip on' : 'chip'}
                    onClick={() => s.updateOrigin(o.id, { thresholds: [m] })}
                  >{m}</button>
                ))}
              </div>
            )}

            <div className="cell-status">
              {(s.bandMode === 'paired' ? s.globalThresholds : o.thresholds).map((m) => {
                const st = s.cells.get(cellKey(o.id, m))
                if (st === 'error') {
                  return (
                    <button key={m} className="retry" onClick={() => void s.retryCell(o.id, m)}>
                      {m} 分钟失败，重试
                    </button>
                  )
                }
                if (st === 'empty') {
                  return <span key={m} className="tag muted">{m} 分钟：周边无公交可达数据</span>
                }
                if (st === 'loading') return <span key={m} className="tag">{m} 分钟：计算中</span>
                return null
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="pane controls">
        <h2>运算</h2>
        <div className="chips">
          {(Object.keys(OP_LABEL) as SetOp[]).map((op) => (
            <button
              key={op}
              className={s.op === op ? 'chip on' : 'chip'}
              onClick={() => s.setOp(op)}
            >{OP_LABEL[op]}</button>
          ))}
        </div>

        <div className="chips">
          <button
            className={s.bandMode === 'paired' ? 'chip on' : 'chip'}
            onClick={() => s.setBandMode('paired')}
          >同档配对</button>
          <button
            className={s.bandMode === 'custom' ? 'chip on' : 'chip'}
            onClick={() => s.setBandMode('custom')}
          >自定义</button>
        </div>

        {s.bandMode === 'paired' && (
          <div className="chips">
            {[15, 30, 45, MAX_MINUTES].map((m) => (
              <button
                key={m}
                className={s.globalThresholds.includes(m) ? 'chip on' : 'chip'}
                onClick={() => s.setGlobalThresholds(
                  s.globalThresholds.includes(m)
                    ? s.globalThresholds.filter((x) => x !== m)
                    : [...s.globalThresholds, m].sort((a, b) => a - b),
                )}
              >{m} 分钟</button>
            ))}
          </div>
        )}

        {s.op === 'difference' && (
          <label className="row">
            基准点
            <select
              value={s.baseOriginId ?? ''}
              onChange={(e) => s.setBaseOrigin(e.target.value || null)}
            >
              <option value="">请选择</option>
              {s.origins.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="pane results">
        <h2>结果</h2>
        {visibleIds.length < 2 && <p className="hint">至少需要两个参与运算的起点</p>}

        {visibleIds.length >= 2 && results.map(({ minutes, result }) => (
          <div className="result-row" key={minutes}>
            <b>{minutes} 分钟</b>
            {result.kind === 'ok' && <span className="ok">{formatArea(result.areaSqM)}</span>}
            {result.kind === 'empty' && <span className="muted">{EMPTY_TEXT[s.op]}</span>}
            {result.kind === 'loading' && <span className="muted">计算中</span>}
            {result.kind === 'unavailable' && (
              <span className="warn">
                数据不全，无法计算（缺 {result.missing.map(nameOf).join('、') || '基准点'}）
              </span>
            )}
          </div>
        ))}

        {exportable.length > 0 && (
          <button className="export" onClick={() => downloadGeoJSON(exportable)}>
            导出 GeoJSON
          </button>
        )}
      </section>
    </aside>
  )
}
```

- [ ] **Step 7: 写侧栏样式**

`src/components/Sidebar.css`：

```css
.sidebar {
  width: 300px;
  flex: none;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f7f7f8;
  border-right: 1px solid #e2e2e5;
  font: 13px/1.5 system-ui, -apple-system, "PingFang SC", sans-serif;
  overflow: hidden;
}
.sidebar h2 {
  font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: #6b7280; margin: 0 0 8px;
}
.pane { padding: 12px; }
.pane.origins { flex: 1; overflow-y: auto; }
.pane.controls { border-top: 1px solid #e2e2e5; }
.pane.results { border-top: 1px solid #e2e2e5; background: #fff; }

.origin-card {
  background: #fff; border: 1px solid #e2e2e5; border-left-width: 4px;
  border-radius: 6px; padding: 8px; margin-bottom: 8px;
}
.origin-card header { display: flex; align-items: center; gap: 4px; }
.label-input { flex: 1; border: none; background: transparent; font-weight: 600; font-size: 13px; }
.label-input:focus { outline: 1px solid #cbd5e1; border-radius: 3px; }
.icon { border: none; background: none; cursor: pointer; color: #9ca3af; font-size: 16px; }
.row { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
select { width: 100%; padding: 3px; border: 1px solid #d1d5db; border-radius: 4px; }

.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.chip {
  padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 4px;
  background: #fff; cursor: pointer; font-size: 12px;
}
.chip.on { background: #111827; color: #fff; border-color: #111827; }

.cell-status { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; }
.tag { font-size: 11px; color: #6b7280; }
.tag.muted { color: #9ca3af; }
.retry {
  font-size: 11px; color: #b91c1c; background: #fef2f2;
  border: 1px solid #fecaca; border-radius: 4px; padding: 2px 6px; cursor: pointer; text-align: left;
}

.search-box { display: flex; gap: 4px; margin-bottom: 10px; }
.search-box input { flex: 1; min-width: 0; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; }
.search-box button { padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; }

.result-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; }
.result-row .ok { color: #111827; font-weight: 600; }
.result-row .muted { color: #9ca3af; }
.result-row .warn { color: #b45309; text-align: right; font-size: 12px; }
.hint { color: #9ca3af; font-size: 12px; margin: 4px 0; }
.hint.error { color: #b91c1c; }
.export {
  width: 100%; margin-top: 8px; padding: 6px;
  border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer;
}
```

- [ ] **Step 8: 接上 App**

`src/App.tsx` 全文替换：

```tsx
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
```

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
```

- [ ] **Step 9: 跑全部测试与类型检查**

Run: `npx tsc --noEmit && npm test`
Expected: 编译无错，全部测试通过

- [ ] **Step 10: 手工验证**

```bash
cp .env.example .env
# 编辑 .env 填入真实的高德 JS API Key
npm run dev
```

在浏览器中依次确认：

1. 搜索「西二旗地铁站」添加起点，地图上出现半透明等时圈
2. 再添加「国贸」作为第二个起点
3. 结果区显示 15 / 30 / 45 三档的共同可达面积
4. 切到「∪ 并集」——结果立即变化且**网络面板无新请求**（缓存生效）
5. 把一个点拖到远郊，30 分钟档应显示「无共同可达区」而不是空白或报错
6. 点「导出 GeoJSON」，下载的文件能被 QGIS 打开

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "feat: 侧栏、搜索加点与 GeoJSON 导出"
```

---

## Self-Review 记录

**Spec 覆盖检查：**

| Spec 章节 | 对应任务 |
|---|---|
| 3.1 技术栈 | Task 1 |
| 3.2 GCJ-02 不转换 | Task 9（直接用坐标）、Task 10（导出标注 crs） |
| 3.3 域名白名单鉴权 | Task 7（loader）、Task 10（fatalError 提示） |
| 4 数据模型 | Task 1 |
| 5.1 provider 契约 | Task 5（接口）、Task 7（实现） |
| 5.2 union 归一化 | Task 2（`normalize`）、Task 4（provider 出口调用） |
| 5.3 缓存 | Task 5 |
| 5.4 并发闸门 | Task 6 |
| 6.1 两种档位模式 | Task 8（`planRequests`）、Task 10（UI 切换） |
| 6.2 三种运算 | Task 2、Task 8（`computeBand`） |
| 6.3 运算前 simplify | Task 2（`simplifyForOps`）、Task 8（调用） |
| 6.4 Turf 7 | Global Constraints、Task 2 |
| 7.1 单侧栏布局 | Task 10 |
| 7.2 加点与拖拽 | Task 9（点击、dragend）、Task 10（搜索） |
| 7.3 导出 | Task 10 |
| 8 四类失败处理 | Task 3（`resolveBandStatus`）、Task 8（store 分类）、Task 10（文案） |
| 9 测试策略 | Task 2–6、8、10 的单元测试；Task 10 Step 10 手工验证 |

无未覆盖项。

**已知取舍：**

- Task 7 无单元测试。可测逻辑已全部抽到 Task 4 的 `transform.ts`，剩余部分是对浏览器全局 `AMap` 的薄封装，为其搭 mock 的收益低于成本。这与 spec 第 9 节「不为外部地图 API 搭 E2E」的判断一致。
- `MapView` 每次状态变化重建图层而非增量更新。等时圈数量级在几十到几百个环，全量重建在这个量级下无感知；增量 diff 会引入一类难查的图层泄漏 bug，不值得。
