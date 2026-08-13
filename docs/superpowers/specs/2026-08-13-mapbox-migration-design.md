# 迁移到 Mapbox — 设计文档

日期：2026-08-13
状态：设计待确认
前置：`2026-08-12-isochrone-tool-design.md`、`2026-08-12-mobile-adaptation-design.md`

## 1. 目标与动机

当前版本只支持公共交通——这是高德 `ArrivalRange` 的唯一能力。用户需要驾车、步行、骑行，改用 Mapbox Isochrone API 作为数据源，并将底图一并换成 Mapbox GL JS。

## 2. 能力变化

| 出行方式 | 迁移前（高德） | 迁移后（Mapbox） |
|---|---|---|
| 公交 / 地铁 | ✅ | ❌ **失去** |
| 驾车 | ❌ | ✅ |
| 步行 | ❌ | ✅ |
| 骑行 | ❌ | ✅ |

**公交能力将被移除。** Mapbox Isochrone 只提供 `driving` / `driving-traffic` / `walking` / `cycling` 四个 profile，不支持公共交通。这是接口的硬限制，已在迁移前明确告知并由用户确认接受。

## 3. 实测依据

迁移前在深圳真机（5G）实测，数据如下：

| 指标 | 首次访问 | 回访（缓存后） |
|---|---|---|
| 底图首屏可用 | 3497 ms | 417 ms |
| 下载总量 | 751 KB | 56 KB |
| 单张瓦片最慢 | 2095 ms | 988 ms |
| Isochrone API | 1681 ms | 45 ms |

结论：偏慢但可用；回访体验良好，首次访问明显慢于高德。用户在知悉该差距后确认接受。

**中文标注**：Mapbox streets 样式在中国区默认使用英文/拼音标注。实测将 24 个 symbol 图层的 `text-field` 改为优先取 `name_zh-Hans` 后，标注可完整中文化，效果满足要求。该处理是本次迁移的必需项，不是可选优化。

## 4. 坐标系

**全栈统一 WGS-84。**

这是本次迁移带来的最大简化。迁移后：

- Mapbox 底图、Isochrone、Geocoding 均为 WGS-84
- 浏览器 `navigator.geolocation` 返回 WGS-84，**定位不再需要坐标转换**
- 导出的 GeoJSON 变为 WGS-84 标准坐标

`src/geo/coord.ts` 的 WGS-84 ↔ GCJ-02 转换在迁移后不再被调用，但**保留**：README 中记录的后续阶段（用高德距离测量 API 做国内驾车网格采样）仍需要它，且它有完整测试、无维护成本。文件顶部注明当前未被使用的状态。

**行为变化**：导出的 GeoJSON 从 GCJ-02 变为 WGS-84。迁移前后导出的文件不可混用。`properties.crs` 相应改为 `WGS-84`。

## 5. 出行方式与档位

### 5.1 Mode

```ts
type Mode = 'driving' | 'driving-traffic' | 'walking' | 'cycling'
```

移除 `transit`。**`driving-traffic`（实时路况驾车）作为用户可选项提供**，UI 上以「驾车（实时路况）」呈现。

实时路况与缓存的矛盾用**时间桶**解决：`driving-traffic` 的缓存指纹额外拼入一个 10 分钟粒度的时间桶（`Math.floor(Date.now() / 600_000)`）。同一时段内切换运算、拖回原点仍零请求；跨时段则重新获取，反映路况变化。其余三种方式的指纹不含时间桶，行为不变。

`Origin.policy`（公交策略）字段随公交能力一并移除。

### 5.2 档位

Mapbox 上限同为 60 分钟，档位设计维持 15 / 30 / 45 / 60 不变。

### 5.3 请求模型

Mapbox Isochrone 单次请求支持一个起点、最多 4 个档位。本次**维持现有 provider 接口**（一次请求一个档位），理由：

- 接口不变则缓存层、闸门、超时、compute 全部无需改动
- 免费额度 10 万次/月，3 点 × 4 档 = 12 次请求，余量充足
- 批量档位是明确的后续优化点，不是当前瓶颈

## 6. 保留与重写

### 6.1 原样保留（坐标系无关）

```
geometry/ops.ts        交集/并集/差集/归一化/简化
geometry/result.ts     面积格式化、档位可用性判定
providers/cache.ts     参数指纹缓存
providers/gate.ts      并发闸门
providers/timeout.ts   超时保护
state/compute.ts       请求矩阵规划与运算编排
ui/responsive.ts       断点与地图点击判定
export.ts              仅改 crs 标注
```

这是 provider 抽象层的直接回报：数据源整体更换，核心逻辑一行不动。

### 6.2 重写

```
providers/amapTransit.ts   → providers/mapbox.ts
providers/transform.ts     → 删除（Mapbox 返回标准 GeoJSON）
components/MapView.tsx     → Mapbox GL JS 重写
components/SearchBox.tsx   → Mapbox Geocoding
amap/loader.ts + errors.ts → mapbox/ 下对应实现
geo/locate.ts              → 移除坐标转换调用
```

### 6.3 因此消失的复杂度

高德那套响应解析全部不再需要：`bounds[块][环][点]` 三层嵌套、字符串坐标、union 归一化、`status: no_data` 却是成功的特例判定。Mapbox 直接返回带 `contour` 属性的标准 GeoJSON Polygon。

保留的只有一条同类陷阱：**必须按 `properties.contour` 匹配档位，不能靠数组下标**——Mapbox 按档位从大到小返回，用 index 取会拿到错误的圈，面积大数倍且无异常迹象。该逻辑已实现并测试（`providers/mapboxTransform.ts`）。

## 7. 搜索

改用 Mapbox Geocoding API（`/geocoding/v5/mapbox.places`），请求时带 `language=zh` 与 `country=cn`。

**已知风险**：Mapbox 在中国的 POI 覆盖弱于高德，「西二旗地铁站」这类站点名可能搜不到。迁移后需实测；若覆盖不可接受，再评估是否将高德搜索作为独立能力保留（届时需将搜索结果由 GCJ-02 转为 WGS-84，`coord.ts` 正为此保留）。

## 8. 失败处理

沿用现有分层：单格失败可重试、空结果是有效结论、配置类错误弹全局横幅。

Mapbox 错误码映射（已实现于 `providers/mapboxTransform.ts`）：

| 状态码 | 含义 |
|---|---|
| 401 | token 无效或缺失 |
| 403 | 权限不足或额度用尽 |
| 422 | 坐标或参数不合法 |
| 429 | 频率超限，自动重试 |

## 9. Token 与安全

`VITE_MAPBOX_TOKEN` 经 GitHub Actions Secrets 注入，与现有高德 key 同一机制。

**约束**：token 不得出现在源码中——GitHub 推送保护会识别并拦截 Mapbox token（迁移准备阶段已实际触发一次）。`public/` 下不经 Vite 处理的独立页面须使用占位符 + CI 构建后替换。

Mapbox token 应在 Mapbox 控制台配置 URL restriction，限定 `raymond1030.github.io`。

## 10. 测试

- **保留的单元测试全部继续有效**（几何层、缓存、闸门、超时、compute、responsive、coord）
- **新增**：`mapboxTransform` 的 URL 构造、档位匹配、错误映射（已完成，16 个测试）
- **删除**：`providers/transform.test.ts`（高德响应解析，随源文件一并移除）
- **视觉验证**：真机 390×844 与桌面两个尺寸，重点确认中文标注、等时圈渲染、抽屉交互未被地图库更换破坏

## 11. 明确不做

- 公交能力的任何替代实现
- 批量档位请求优化
- 海外区域的专门适配（虽然迁移后技术上已可行）
