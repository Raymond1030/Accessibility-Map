import { distance, point } from '@turf/turf'
import type { MetroNetwork, MetroStation } from './types'

/**
 * 地铁网络图。节点是「线路上的站」（同名换乘站在每条线上各是一个节点），
 * 三类边：
 *   区间边（双向）—— 相邻站运行时间 + 停站时间
 *   换乘边（双向）—— 同名跨线站之间：换乘走行 + 目标线候车（班距一半）
 * 候车模型：上车必等车。进站候车摊在起点初始代价里（见 metroReachability），
 * 换乘候车摊在换乘边里——两处的口径一致：班距 / 2 的期望值。
 */

export type GraphNode = {
  station: MetroStation
  lineId: string
  /** 该线的班距（分钟） */
  headwayMin: number
  /** 邻接表：[目标节点下标, 耗时分钟] */
  edges: Array<[number, number]>
}

export type MetroGraph = {
  nodes: GraphNode[]
  /** stationId → 节点下标 */
  byStationId: Map<string, number>
}

export function buildGraph(net: MetroNetwork): MetroGraph {
  const d = net.defaults
  const nodes: GraphNode[] = []
  const byStationId = new Map<string, number>()
  const byName = new Map<string, number[]>()

  for (const line of net.lines) {
    const headwayMin = line.headwayMin ?? d.headwayMin
    for (const station of line.stations) {
      const idx = nodes.length
      nodes.push({ station, lineId: line.id, headwayMin, edges: [] })
      byStationId.set(station.id, idx)
      const list = byName.get(station.name)
      if (list) list.push(idx)
      else byName.set(station.name, [idx])
    }
  }

  // 区间边
  for (const line of net.lines) {
    for (let i = 0; i + 1 < line.stations.length; i++) {
      const a = byStationId.get(line.stations[i].id)!
      const b = byStationId.get(line.stations[i + 1].id)!
      const run = line.runTimesMin?.[i]
        ?? (distance(point(nodes[a].station.lngLat), point(nodes[b].station.lngLat))
          / d.runSpeedKmph) * 60
      const cost = run + d.dwellMin
      nodes[a].edges.push([b, cost])
      nodes[b].edges.push([a, cost])
    }
  }

  // 换乘边：同名跨线两两互连
  for (const idxs of byName.values()) {
    for (const a of idxs) {
      for (const b of idxs) {
        if (a === b || nodes[a].lineId === nodes[b].lineId) continue
        nodes[a].edges.push([b, net.defaults.transferMin + nodes[b].headwayMin / 2])
      }
    }
  }

  return { nodes, byStationId }
}

export type MetroEntry = {
  stationId: string
  /** 到达站外的时间（接驳段），不含进站与候车 */
  accessMin: number
}

/**
 * 多源 Dijkstra：从若干进站点出发，算出预算内每个可达站的最早总耗时（分钟）。
 * 初始代价 = 接驳 + 进站走行 + 候车（班距一半）。
 * 返回 stationId → 总耗时，只含 ≤ budget 的站。
 */
export function metroReachability(
  graph: MetroGraph,
  entries: MetroEntry[],
  budgetMin: number,
  boardMin: number,
): Map<string, number> {
  const n = graph.nodes.length
  const dist = new Array<number>(n).fill(Infinity)

  // 二叉堆。464 个节点用数组扫也够快，但堆写出来同样简单且不留隐患
  const heap: Array<[number, number]> = [] // [cost, nodeIdx]
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = (): [number, number] | undefined => {
    if (heap.length === 0) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }

  for (const e of entries) {
    const idx = graph.byStationId.get(e.stationId)
    if (idx === undefined) continue
    const cost = e.accessMin + boardMin + graph.nodes[idx].headwayMin / 2
    if (cost < dist[idx] && cost <= budgetMin) {
      dist[idx] = cost
      push([cost, idx])
    }
  }

  while (true) {
    const top = pop()
    if (!top) break
    const [cost, u] = top
    if (cost > dist[u]) continue // 堆里的过期项
    for (const [v, w] of graph.nodes[u].edges) {
      const next = cost + w
      if (next < dist[v] && next <= budgetMin) {
        dist[v] = next
        push([next, v])
      }
    }
  }

  const out = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    if (dist[i] <= budgetMin) out.set(graph.nodes[i].station.id, dist[i])
  }
  return out
}
