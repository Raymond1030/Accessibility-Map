# 开发文档

面向开发者的技术说明。使用说明见根目录 [README](../README.md)。

## 快速开始

```bash
npm install
cp .env.example .env      # 填入 VITE_MAPBOX_TOKEN
npm run dev
```

Token 从 [Mapbox 控制台](https://account.mapbox.com/access-tokens/) 获取（pk. 开头的公开 token）。它会暴露在前端，应在控制台配置 **URL restriction** 限定部署域名。**token 不要写进任何源码文件**——GitHub 推送保护会识别 Mapbox token 并直接拦下提交。

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm test` | 跑全部单元测试 |
| `npm run typecheck` | 类型检查 |
| `npm run build` | 生产构建（含类型检查） |

## 设计边界

这些不是待办事项，是当前版本的设计决定：

**1. 不支持公共交通。** v1 曾用高德 `ArrivalRange` 提供公交等时圈，迁移到 Mapbox 后该能力被移除——Mapbox Isochrone 只有 driving / driving-traffic / walking / cycling 四个 profile。这是接口的硬限制，v1 的高德实现保留在 git 历史中（`git log --oneline | grep 高德`）。

**2. 国内首次加载偏慢，标注靠运行时中文化。** 底图与数据都来自 Mapbox（境外服务）。深圳 5G 实测：首次打开约 3.5 秒、751 KB；缓存后约 0.4 秒。地图标注默认英文/拼音，应用在 style 加载后把全部 symbol 图层改为优先取 `name_zh-Hans`——OSM 数据里没有中文名的要素仍会显示原文。国内路网基于 OSM，精度不如高德。

**3. 全栈 WGS-84 标准坐标。** 底图、等时圈、定位、导出的 GeoJSON 全部是 WGS-84。唯一的转换在搜索入口：**地名搜索走高德**（Mapbox Geocoding 在国内连「深圳北站」都只能匹配到城市级），高德返回的 GCJ-02 经 `src/geo/coord.ts` 转成 WGS-84 后进入系统。

## 架构

```
src/
├─ providers/          ← 唯一知道 Mapbox 存在的地方
│  ├─ mapbox.ts          调用 Isochrone API
│  ├─ mapboxTransform.ts URL 构造、档位匹配、错误映射
│  ├─ cache.ts           参数指纹缓存 + 在飞请求合并
│  ├─ gate.ts            并发闸门（上限 4）+ 指数退避重试
│  ├─ timeout.ts         请求超时保护
│  └─ index.ts           withCache(withGate(withTimeout(provider)))
├─ mapbox/             ← token
├─ geo/                ← 定位；coord.ts 为后续保留
├─ geometry/           ← 纯函数，不碰网络
│  ├─ ops.ts             交集/并集/差集/归一化/简化
│  └─ result.ts          面积格式化、档位可用性判定
├─ state/
│  ├─ compute.ts         请求矩阵规划、档位运算编排
│  └─ store.ts           zustand
└─ components/         ← 单侧栏/底部抽屉 + 全屏地图
```

### 三个不显眼但关键的设计

**Provider 是唯一的数据源接触面。** 它对外只吐标准 GeoJSON。几何层和 UI 层完全不知道数据来自哪里——这层抽象让本项目从高德整体迁到 Mapbox 时，几何、缓存、闸门、编排一行未改。

**档位必须按 `properties.contour` 匹配，不能靠数组下标。** Mapbox 把 features 按档位从大到小返回，用 index 取会拿 15 分钟的下标得到 45 分钟的范围——面积大三倍且毫无异常迹象。

**运算前 simplify 是正确性前提。** 等时圈顶点数多时连续 `intersect` 会阻塞主线程。以约 10 米容差预简化——等时圈本身精度远粗于 10 米，不损失有效信息。

### 空结果的处理原则

缺数据时绝不用残缺的点集合去算交集。那会得出一个看起来完全正常、实则错误的结果——比三个点的交集少算一个点，面积只会变大，没有任何异常迹象。因此某档任一点数据缺失时，整档标为「数据不全，无法计算」并列出缺哪个点；单点单档请求失败可独立重试，不阻断其余档位。

### 请求量与缓存

请求数是 `点数 × 档位数`。缓存的参数指纹形状决定了三件事：

- 切换交集/并集/差集 → **零请求**（纯几何重算）
- 点拖走再拖回原位 → **零请求**
- 给某点新增一个档位 → **只请求那一档**

例外是「驾车（实时路况）」：它的指纹拼入 10 分钟时间桶——同一时段内仍零请求，跨时段重新获取以反映路况变化。所有请求经过并发闸门（同时最多 4 个）+ 超时保护 + 退避重试。

## 测试

```bash
npm test    # 116 个测试
```

测试集中在几何运算层和 provider 转换层——逻辑密度最高、出错最不显眼的地方。全部是纯函数测试，不碰网络。

UI 组件和 `mapbox.ts` 的网络壳没有单元测试：可测逻辑（URL 构造、档位匹配、错误映射、时间桶）全部在纯函数层覆盖，为地图 SDK 搭 mock 的收益低于成本。

### 一条从高德时代留下的教训

v1 用高德时踩过三个只有真实环境能暴露的坑（回调静默不触发、成功却报 no_data、bounds 结构与文档不符——详见 git 历史中的对应提交）。共同教训是：**自己造的 fixture 测不出对接口的错误假设**。因此本版的 `pickContour` fixture 直接取自 Mapbox 真实响应，且超时保护（`withTimeout` 在闸门内层）作为通用防线保留——任何数据源都可能挂死。

## 后续阶段

**公交等时圈回归。** 若需要，可将 v1 的高德 `ArrivalRange` provider 从 git 历史恢复为第二数据源，按 mode 分流，出入口做 GCJ-02 ↔ WGS-84 转换（搜索链路已在这么做）。

**批量档位请求。** Mapbox 单次请求最多可带 4 个档位，可把请求数从「点数 × 档位数」降到「点数」。当前额度充足（10 万次/月），未做。

## 设计文档

- v1 设计（高德公交）：`superpowers/specs/2026-08-12-isochrone-tool-design.md`
- 移动端适配：`superpowers/specs/2026-08-12-mobile-adaptation-design.md`
- Mapbox 迁移：`superpowers/specs/2026-08-13-mapbox-migration-design.md`

## 技术栈

React 18 · TypeScript · Vite · Vitest · Turf.js 7 · zustand · Mapbox GL JS 3

> Turf 7 的 `intersect` / `union` / `difference` 接收 `FeatureCollection` 单一参数，与网上大量 Turf 6 示例不兼容。改这部分代码时注意版本。
