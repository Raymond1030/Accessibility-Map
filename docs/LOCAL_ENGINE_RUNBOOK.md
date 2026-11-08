# 本地可达性引擎运行说明

本地引擎使用 GraphHopper 11.0、JDK 17+、Python 3.8+ 和 Node 18+。需要完整 JDK（含 Java 源文件启动能力及测试所用 javac）。Python 部分只用标准库，不需要 Docker、conda、GIS 数据库或路由 API Key。地图底图及搜索仍沿用项目原有配置。

算法与来源见 [方法说明](LOCAL_ENGINE_METHOD.md)，流程图见 [PNG](assets/local-engine-flow.png) 和 [Mermaid 源码](assets/local-engine-flow.mmd)。

本机已完成的真实查询、缓存重启与资源记录见 [验收记录](LOCAL_ENGINE_VALIDATION.md)。

## 启动

在项目根目录打开终端：

```powershell
npm run engine:prepare -- --region guangdong
npm run engine:start -- --region guangdong --heap 3g
```

准备命令下载广东 OSM（本身包含香港和澳门）、香港 GTFS 和固定版本的引擎。启动命令首次建图，终端出现 `READY` 后可查询。引擎终端保持运行；停止时输入 `stop` 并按 Enter，等待 Java 退出再关闭终端。脚本也处理 Ctrl+C，但某些 Windows 终端宿主会直接终止整棵进程树，所以推荐输入 `stop`。

正常停止通过关闭父进程管道，请 Java 执行服务关闭钩子并写回公交缓存；不要直接在任务管理器结束 Java。Windows 的 Node `child.kill()` 会强制终止进程，可能导致 GTFS 的 MapDB 文件下次打不开，因此启动脚本使用项目内 `EngineHost.java` 管理退出。若异常断电或强制关闭后出现 `Wrong index checksum`，用下述 `--rebuild` 保留旧图并重建。[Node 子进程终止行为](https://nodejs.org/download/release/v18.17.1/docs/api/child_process.html#subprocesskillsignal)

另开终端启动地图：

```powershell
npm run dev:local
```

打开终端给出的本机网址。若端口被已有开发服务使用，可运行 `npm run dev:local -- --port 5174`。`dev:local` 只为该进程启用本地 provider，不修改 `.env`，普通 `npm run dev` 与生产构建继续使用原配置。

在“生活半径”中添加起点，选择步行、骑行、驾车或公交，计算交集、并集、差集。公交出现日期时刻输入，按 UTC+08:00 解释；方向可选出发或到达。也可在“租房通勤 → 看通勤圈”针对一个工作地计算。

本地状态卡显示已加载地区、图版本与公交缺口。服务未启动时明确报错，不静默使用在线路由。

## 区域与导入

| 参数 | 范围 | 默认公共交通数据 |
| --- | --- | --- |
| `--region guangdong` | 广东、香港、澳门 | 香港运输署 GTFS |
| `--region hong-kong` | 香港小区域 | 香港运输署 GTFS |
| `--region macau` | 澳门小区域 | 无；可计算道路模式 |

内存有限时，先试澳门：

```powershell
npm run engine:prepare -- --region macau
npm run engine:start -- --region macau --heap 768m
```

引擎只运行一份；更换区域先停止当前引擎。要只准备道路，加 `--no-transit`。手工导入合法取得的 GTFS ZIP：

```powershell
npm run engine:prepare -- --region guangdong --gtfs D:\data\my-feed.zip
```

`--gtfs` 可以重复。使用 `--no-transit --gtfs ...` 可不加入默认香港 feed。GTFS 文件必须位于 ZIP 根目录，包含标准必需表，并至少有 calendar.txt 或 calendar_dates.txt；校验会报告缺文件、无效坐标、缺失引用和服务日期。导入时保留原发布者与许可说明。完整 GTFS 合规性仍应使用发布方或 MobilityData 的标准验证器核查。

香港运输署本次 feed 包含巴士、电车、渡轮、缆车，**没有港铁重铁**。深圳地铁另用项目静态线网估算，并以本地步行路网接驳。广东其他城市、澳门公交与轨道的目录入口保存在 [sources.json](../engine/sources.json)，没有编造 GTFS 来补齐。

## 更新、校验与故障恢复

```powershell
npm run engine:prepare -- --region guangdong --refresh
npm run engine:start -- --region guangdong
```

下载失败留下 `.part`，下次准备可续传；若来源文件已换版而导致校验不符，会删除不一致的半包并报错，再运行准备命令即可。大文件完成前不会用于建图。

源文件哈希、配置和图版本不匹配时，启动会拒绝混用。旧图没有成功启动标记时，可使用 `--rebuild`：它保留旧图为 `.previous-时间戳` 目录，再建新图，不自动递归删除旧数据。

```powershell
npm run engine:start -- --region guangdong --rebuild
```

引擎只监听 `127.0.0.1`：适配服务默认 **8787**，GraphHopper **8989**。可用 `--port 8788` 修改适配服务端口，并在地图进程设置 `VITE_LOCAL_ENGINE_URL=http://127.0.0.1:8788`。GraphHopper 的 8989 已被占用时会明确停止，避免连到另一份数据。

若 Java 不在 PATH，通过 `LOCAL_ENGINE_JAVA` 指定 java.exe。启动脚本为 Java 指定项目内临时目录，处理部分 Windows 环境中短路径 TEMP 导致的 `Unable to establish loopback connection`。该设置只影响所启动的 Java 进程。[Java 网络属性说明](https://docs.oracle.com/en/java/javase/17/core/java-networking.html)

## API

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/sources

$query = @{
  lngLat = @(114.1722, 22.2988)
  mode = 'transit-walking'
  minutes = 30
  direction = 'arrive'
  dateTime = '2026-11-07T08:00:00+08:00'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/isochrone `
  -ContentType application/json -Body $query
```

| 字段 | 要求 |
| --- | --- |
| `lngLat` | WGS-84 `[经度, 纬度]` |
| `mode` | `walking`、`cycling`、`driving`、`transit-walking` |
| `minutes` | 1–60 整数 |
| `direction` | `depart` 或 `arrive`；默认 depart |
| `dateTime` | 公交必填，带时区的 ISO 8601；上例需改为 feed 覆盖的实际查询日期 |

成功返回 GeoJSON FeatureCollection，metadata 含区域、模式、方向、时刻、来源及图版本。合法空结果为 `features: []`。400 是输入错误，422 是无数据或图查询失败，429 是繁忙，503 是尚未启动或建图中，504 是超时，502 是上游返回异常。公交查询点需在某个适用 feed 的站点 2.5 公里范围内；此门槛用于识别数据缺口，不代表步行接驳上限。日期检查覆盖整个出发／到达时间窗口及延续至次日的班次、频率服务；具体能否赶上车辆由 GraphHopper 判断。

引擎一次处理一个等时圈，前端依次排队，避免多份公交搜索同时占用内存。省级路网加香港 GTFS 默认 Java 堆为 3 GB；2 GB 在重启后的公交查询中出现过内存不足。MMAP 和 Java 堆以外也会占用内存。公交不使用永久结果缓存；重新加载不同版本的数据后不会继续命中旧公交圈。

取消页面请求会阻止旧结果覆盖新结果；已经开始的 GraphHopper 搜索仍须等它结束。服务端保留计算名额，期间新查询返回繁忙，可稍后重试。超时同样不会立刻释放正在运算的名额。

## 验证与文件

```powershell
python -m unittest discover -s engine -p test_prepare.py
npm run engine:test
npm run engine:smoke
npm run build
```

`engine:smoke` 通过正在运行的真实服务，按当前图检查区域样点，保存查询、GeoJSON、面积与耗时；广东配置还会查询香港公交的出发圈和到达圈。

Node 18 下原有前端测试需要向 Vitest 工作进程提供 Web Crypto：

```powershell
$env:NODE_OPTIONS = '--experimental-global-webcrypto'
npm test
```

该变量仅在当前 PowerShell 会话中生效。Node 20+ 通常无需此兼容开关。

| 路径 | 内容 |
| --- | --- |
| `engine/sources.json` | 可审核的来源与覆盖目录 |
| `engine/.local/downloads/` | 原始 PBF、GTFS、下载清单 |
| `engine/.local/runtime/` | SHA-256 校验的 GraphHopper JAR |
| `engine/.local/<region>/manifest.json` | 区域数据清单、GTFS 检查、来源与版本 |
| `engine/.local/<region>/graph-<version>/` | 建图缓存 |
| `engine/.local/<region>/graphhopper.log` | 运行日志 |
| `engine/.local/evidence/<version>/` | 真实样例响应和报告 |

`.local` 被 Git 忽略。方法、图、代码、测试与使用说明留在仓库，原始数据与大型图文件在本机按清单复现。
