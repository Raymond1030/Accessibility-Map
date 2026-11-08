import { distance, point } from '@turf/turf'
import { normalize, simplifyForOps, type PolyFeature } from '../geometry/ops'
import { estimateAccess } from '../transit/access'
import { buildGraph, metroArrivalCosts, metroReachability } from '../transit/graph'
import type { MetroNetwork } from '../transit/types'
import type { IsochroneProvider } from './cache'

export type MetroRangeInfo = {
  engine: 'local-metro-dijkstra'
  direction: 'arrive' | 'depart'
  dataDate: string
  maxWalkMinutes: number
  lines: string[]
  stations: Array<{ id: string; name: string; lngLat: [number, number]; line: string; walkMinutes: number }>
  limitations: string[]
}

export function metroRangeInfo(feature: PolyFeature | null): MetroRangeInfo | null {
  const info = feature?.properties?.metro
  return info?.engine === 'local-metro-dijkstra' ? info as MetroRangeInfo : null
}

/**
 * 静态地铁图 + Mapbox 步行路网。轨道段由本地 Dijkstra 求解，不调用 ArrivalRange。
 * 步行暂按双向可通行近似：目的地周围的出发轮廓用于估算到达时间。
 * 每端最多步行 15 分钟；终点接驳向上取档，起点剩余预算向下取整到分钟。
 * 不做凸包、不用圆形缓冲，也不按距离抽稀相邻站，保留不连通区域和空洞。
 */
export function createMetroWalkingProvider({ leg, network }: {
  leg: IsochroneProvider; network: MetroNetwork
}): IsochroneProvider {
  const graph = buildGraph(network)
  const stations = network.lines.flatMap(line => line.stations)
  const lineByStation = new Map(network.lines.flatMap(line => line.stations.map(s => [s.id, line.id] as const)))
  const d = network.defaults
  const maxWalkMinutes = 15

  return {
    id: 'local-metro-walking-v1',
    supportedModes: ['subway-walking'],
    async fetch(req) {
      if (req.mode !== 'subway-walking') throw new Error('本地地铁引擎只支持地铁＋步行。')
      if (!Number.isInteger(req.minutes) || req.minutes < 1 || req.minutes > 60) throw new Error('时间须为 1–60 分钟。')
      if (!stations.some(s => distance(point(s.lngLat), point(req.lngLat)) <= 20)) {
        throw new Error('本地地铁引擎目前仅覆盖深圳线网；此位置不在数据覆盖范围内。')
      }
      const check = () => req.signal?.throwIfAborted()
      check()
      const direction = req.direction ?? 'depart'
      req.onProgress?.('正在读取工作地周边步行路网…')
      const buckets = [...new Set([2, 5, 8, 10, 12, 15, req.minutes].filter(m => m <= req.minutes))].sort((a, b) => a - b)
      // 同步发出的腿请求由共享 provider 限流；所有腿缺失或错误都明确处理。
      const contours: Array<{ minutes: number; feature: PolyFeature | null }> = []
      for (const minutes of buckets) {
        check()
        contours.push({ minutes, feature: await leg.fetch({ lngLat: req.lngLat, mode: 'walking', minutes, signal: req.signal }) })
      }
      check()
      const direct = contours.find(c => c.minutes === req.minutes)!.feature
      const entries = estimateAccess(stations, contours.filter(c => c.minutes <= maxWalkMinutes))
      const costs = direction === 'arrive'
        ? metroArrivalCosts(graph, entries, req.minutes, d.boardMin, d.exitMin)
        : new Map([...metroReachability(graph, entries, req.minutes, d.boardMin)].map(([id, cost]) => [id, cost + d.exitMin]))

      // 仅完全相同坐标合并；近邻站可能被河流/围墙分开，不能按直线距离删去。
      const byPlace = new Map<string, { lngLat: [number, number]; minutes: number }>()
      const reached: MetroRangeInfo['stations'] = []
      for (const station of stations) {
        const cost = costs.get(station.id)
        if (cost === undefined) continue
        const minutes = Math.min(maxWalkMinutes, Math.floor(req.minutes - cost))
        if (minutes < 1) continue
        reached.push({ ...station, line: lineByStation.get(station.id)!, walkMinutes: minutes })
        const key = station.lngLat.join(',')
        const prev = byPlace.get(key)
        if (!prev || prev.minutes < minutes) byPlace.set(key, { lngLat: station.lngLat, minutes })
      }
      const tasks = [...byPlace.values()]
      const pieces: PolyFeature[] = direct ? [direct] : []
      let completed = 0
      let failed = false
      const report = () => req.onProgress?.(`地铁寻路完成，正在计算车站步行覆盖 ${completed}/${byPlace.size}…`)
      report()
      async function worker() {
        while (!failed) {
          check()
          const task = tasks.shift()
          if (!task) return
          try {
            const feature = await leg.fetch({ ...task, mode: 'walking', signal: req.signal })
            check()
            // null 不等于无地铁可达：车站步行数据缺失时不能默默给出残缺成功结果。
            if (!feature) throw new Error('部分车站缺少步行路网，无法生成完整地铁通勤圈。请重试或更换工作地。')
            pieces.push(feature)
            completed++
            report()
          } catch (error) { failed = true; throw error }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, () => worker()))
      check()
      req.onProgress?.('正在合并步行覆盖范围…')
      const geometry = normalize(pieces.map(simplifyForOps))
      if (!geometry) return null
      const info: MetroRangeInfo = {
        engine: 'local-metro-dijkstra', direction, dataDate: network.generatedAt ?? '未标注', maxWalkMinutes,
        lines: [...new Set(reached.map(s => s.line))], stations: reached, limitations: network.limitations ?? [],
      }
      return { ...geometry, properties: { ...geometry.properties, metro: info } }
    },
  }
}
