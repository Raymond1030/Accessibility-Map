#!/usr/bin/env node
/**
 * 从 OSM Overpass 提取深圳地铁网络，生成 src/data/metro/shenzhen.json。
 *
 * 一次性脚本：数据是静态打包进应用的，只有地铁线网变化（新线开通）时才需要重跑。
 *   node scripts/build-metro-data.mjs
 *
 * OSM 坐标即 WGS-84，与全栈坐标系一致，无需转换。
 * 区间运行时间 OSM 没有，留空由 graph.ts 按站间球面距离估算。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

// 深圳市大致范围。用 bbox 而非行政区 area 查询：快一个数量级，
// 混进来的港铁/东莞线路靠 network 标签过滤。
const BBOX = '22.40,113.70,22.90,114.70'
const NETWORK = '深圳地铁'

async function overpass(query) {
  let lastErr
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            // Overpass 镜像对无 UA 的请求直接 429/406
            'User-Agent': 'accessibility-map/0.1 (metro data build script; github.com/Raymond1030/Accessibility-Map)',
          },
          body: new URLSearchParams({ data: query }),
        })
        const text = await res.text()
        if (!res.ok || text.trimStart().startsWith('<')) {
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`)
        }
        return JSON.parse(text)
      } catch (err) {
        lastErr = err
        console.error(`  ${url} 失败（第 ${attempt + 1} 次）：${err.message ?? err}`)
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }
  throw lastErr
}

console.log('拉取深圳地铁线路关系…')
const relData = await overpass(
  `[out:json][timeout:60];rel(${BBOX})["route"="subway"]["type"="route"]["network"="${NETWORK}"];out body;`,
)
const relations = relData.elements.filter((e) => e.type === 'relation')
console.log(`  ${relations.length} 条方向关系`)

// 每条线在 OSM 里通常是上行/下行两条关系，取站数多的那条——
// 边是双向的，一条方向就足以覆盖整条线
const byRef = new Map()
for (const rel of relations) {
  const ref = rel.tags.ref ?? rel.tags.name
  const stops = rel.members.filter((m) => m.type === 'node' && m.role.startsWith('stop'))
  if (stops.length < 2) continue
  const prev = byRef.get(ref)
  if (!prev || stops.length > prev.stops.length) byRef.set(ref, { rel, stops })
}
console.log(`  归并为 ${byRef.size} 条线路：${[...byRef.keys()].sort().join(', ')}`)

const nodeIds = [...new Set([...byRef.values()].flatMap(({ stops }) => stops.map((s) => s.ref)))]
console.log(`拉取 ${nodeIds.length} 个站点坐标…`)
const nodeData = await overpass(`[out:json][timeout:60];node(id:${nodeIds.join(',')});out body;`)
const nodes = new Map(nodeData.elements.map((n) => [n.id, n]))

const lines = []
for (const [ref, { rel, stops }] of [...byRef.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh', { numeric: true }))) {
  const stations = []
  for (const s of stops) {
    const node = nodes.get(s.ref)
    if (!node) continue
    const name = node.tags?.name
    if (!name) continue // 无名 stop 多半是数据残缺，跳过比编造名字好
    stations.push({
      id: `${ref}-${stations.length + 1}`,
      name,
      lngLat: [Number(node.lon.toFixed(6)), Number(node.lat.toFixed(6))],
    })
  }
  if (stations.length < 2) continue
  lines.push({ id: String(ref), name: rel.tags.name ?? `${ref}号线`, stations })
}

const out = {
  city: 'shenzhen',
  crs: 'WGS-84',
  source: `OSM Overpass（route=subway, network=${NETWORK}），ODbL 许可`,
  generatedAt: new Date().toISOString().slice(0, 10),
  defaults: {
    headwayMin: 5,
    transferMin: 4,
    boardMin: 2,
    exitMin: 2,
    dwellMin: 0.75,
    runSpeedKmph: 35,
  },
  lines,
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/data/metro')
mkdirSync(dir, { recursive: true })
const file = join(dir, 'shenzhen.json')
writeFileSync(file, JSON.stringify(out, null, 1))
const total = lines.reduce((n, l) => n + l.stations.length, 0)
console.log(`已写入 ${file}：${lines.length} 条线路，${total} 个站点`)
