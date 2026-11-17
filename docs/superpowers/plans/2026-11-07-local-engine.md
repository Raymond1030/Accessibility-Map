# 粤港澳本地可达性引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在当前 Windows 项目中部署能用真实 OSM 和香港 GTFS 计算的本地引擎，并接入已有地图。

**Architecture:** GraphHopper 11.0 提供道路与公交等时圈；Node 本地适配层统一输入、覆盖检查、错误与来源；React provider 使用现有集合运算。Python 标准库负责可复现的数据准备和 GTFS 检查。

**Tech Stack:** Java 17、GraphHopper 11.0、Python 3.8+、Node 18+、React、TypeScript、Vitest。

**Spec:** `docs/LOCAL_ENGINE_METHOD.md`

## Global Constraints

- 用户已授权直接实施并由执行者决定细节；用户补充要求先留存方法文档与 imagegen 流程图。
- 保留工作区已有未提交的界面修改，在当前非主分支就地完成；不发布或推送。
- OSM 广东包已含港澳，不重复合并；公交覆盖不伪造港铁或粤澳时刻表。
- 下载与图缓存置于忽略目录；清单记版本、哈希、来源、日期。
- 本地 API 只绑定 127.0.0.1；不将服务失败当成合法空圈，不静默使用外部路由。

## Review Focus

- 旧图配新数据清单：启动需核验建图身份；更新数据后不得误报已加载新版本。
- 反向出行：道路和公交到达方向正确传递；不能把出发圈称作到达圈。
- 缺失或过期公交：日期与覆盖不足需明确报错；没有港铁也不能声称全模式覆盖。
- Node 18 与 Windows：实际命令可以运行，异常退出不留下无管理的 Java 进程。
- 坐标、取消与缓存：WGS-84 lng/lat、时间单位、AbortSignal 与请求时刻不能串用。

### Task 1: 方法归档与数据准备

Files: `docs/LOCAL_ENGINE_METHOD.md`, `docs/assets/local-engine-flow.*`, `engine/sources.json`, `engine/prepare.py`, `engine/test_prepare.py`.

Interfaces: `prepare.py --region {guangdong,hong-kong,macau}` 生成 `engine/.local/<region>/config.yml` 与 `manifest.json`；清单包含 `region`, `dataVersion`, `osm`, `gtfs`, `bbox`（含站点与服务日历覆盖检查）。

- [x] 保存方法、Mermaid、imagegen 图片及生成提示词，再进入实现。
- [x] 先测试 GTFS 文件缺失、无轨道类型、日期信息与无效经纬度，运行观察失败。
- [x] 实现校验下载、检查清单、配置生成及自备 GTFS 导入。
- [x] 运行 Python 单元测试；实际下载三地区示例需要的数据；校验哈希。

### Task 2: 本地服务与真实建图

Files: `engine/gateway.mjs`, `engine/gateway.test.mjs`, `engine/start.mjs`, `engine/smoke.mjs`.

Interfaces: `GET /health`, `GET /sources`, `POST /isochrone`；请求为 `{lngLat, mode, minutes, direction, dateTime?}`，成功响应为 GeoJSON FeatureCollection 加来源元数据，失败为 `{error:{code,message}}`。

- [x] 先测试参数约束、lat/lon 转换、reverse_flow、GTFS 日期覆盖、错误状态与来源版本。
- [x] 实现本地适配器、进程管理、启动就绪探测、图身份核验和流量上限。
- [x] 真实建图并在三地样点测试，保存响应和性能数据，记录未达标项。

### Task 3: 地图接入与验收

Files: `src/providers/local.ts`, `src/providers/local.test.ts`, `src/providers/index.ts`, `src/providers/cache.ts`, `src/commute/range.ts`, `src/commute/store.ts`, `src/components/WorkplaceRange.tsx`, `.env.example`, `package.json`, `README.md`, `docs/LOCAL_ENGINE_RUNBOOK.md`.

Interfaces: `createLocalProvider(baseUrl)` 返回 `IsochroneProvider`；`VITE_LOCAL_ENGINE_URL` 启用本地路网和香港公交，深圳静态地铁继续使用原算法并注入本地步行 provider。

- [x] 测试 provider 请求与响应、错误传播、公交时刻缓存和既有默认配置。
- [x] 接入现有通勤圈，提供日期时间输入与公交覆盖提示，补充本地启动命令。
- [x] 运行完整测试、类型检查和构建；用真实本地接口完成一次端到端查询。
- [x] 按方法文档审查整个变更，修复重要问题；保存运行记录和使用文档。

## 执行记录

- 2026-11-07 基线：原有 284 个 Vitest 测试，280 通过；4 个因 Node 18 默认没有全局 crypto 失败，涉及 commute/store.test.ts 与 commute/range.test.ts。用 Node 的 global webcrypto 兼容开关复核，避免误归因于引擎改动。
- 确认 GraphHopper 11.0 发布包 SHA-256：`b59c024afe172ec6ec85b6327006c3138ec58c7d0bcd26253d0e42853f613def`。
- 确认香港 routes.txt 包含类型 0/3/4/7，没有 1/2；当前 calendar 的宽日期边界不是数据更新新鲜度保证。
