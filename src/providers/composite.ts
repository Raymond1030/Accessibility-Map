import { distance, point } from '@turf/turf'
import { normalize, simplifyForOps, type PolyFeature } from '../geometry/ops'
import { buildGraph, metroReachability, type MetroGraph } from '../transit/graph'
import { estimateAccess, type AccessContour } from '../transit/access'
import type { MetroNetwork, MetroStation } from '../transit/types'
import type { IsochroneProvider } from './cache'
import type { Mode } from '../types'

/**
 * 自建组合等时圈 provider：接驳（骑行）→ 地铁 → 接驳（骑行）。
 *
 * 托管 API 没有这种组合（高德 ArrivalRange 只有「公共交通+步行」），
 * 所以自己拼：三段各自可解——接驳段问 Mapbox，轨道段在静态地铁图上跑
 * 多源 Dijkstra，最后把「不坐地铁的直达区」和每个可达车站向外的接驳圈并起来。
 *
 * 所有对外网的请求都通过注入的 leg provider（即共享的 Mapbox 栈）发出，
 * 于是缓存/闸门/超时对腿级请求天然生效；车站坐标固定，接驳圈按
 * (车站, 模式, 分桶时间) 命中缓存，拖动起点后的增量请求极少。
 */

/** 进站接驳的档位。骑行超过 15 分钟还没到地铁站，这趟组合出行基本不成立 */
const ACCESS_BUCKETS = [5, 10, 15]

/**
 * 出站接驳的档位。剩余时间**向下**取档——等时圈承诺「T 分钟内一定可达」，
 * 向下取整只把结果画小，不会画大。低于最小档的车站直接丢弃。
 */
const EGRESS_BUCKETS = [5, 10, 15, 20, 30]

/**
 * 接驳圈抽稀半径（公里）。相邻地铁站间距约 1 公里，接驳圈最小也有
 * 5 分钟骑行（约 1.5 公里半径）——两个挨着的车站画出来的圈几乎重合。
 * 抽稀能砍掉换乘站的同名重复节点和贯通线路（2/8号线）的重复走廊，
 * 首刷请求量约降一半，结果几何肉眼无差。
 */
const THIN_RADIUS_KM = 0.8

export type CompositeOptions = {
  /** 接驳段数据源，注入共享的 Mapbox provider 栈以复用缓存与闸门 */
  leg: IsochroneProvider
  network: MetroNetwork
  /** 组合里的接驳模式 → 对应的腿级模式 */
  legMode?: Mode
}

function largestBucketAtMost(buckets: number[], v: number): number | null {
  let best: number | null = null
  for (const b of buckets) if (b <= v && (best === null || b > best)) best = b
  return best
}

/** 网络覆盖范围（外扩约 0.15° ≈ 15 公里）。起点离线网太远时快速失败，不烧一堆请求 */
function networkBBox(net: MetroNetwork): [number, number, number, number] {
  let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity
  for (const line of net.lines) {
    for (const s of line.stations) {
      minLng = Math.min(minLng, s.lngLat[0]); maxLng = Math.max(maxLng, s.lngLat[0])
      minLat = Math.min(minLat, s.lngLat[1]); maxLat = Math.max(maxLat, s.lngLat[1])
    }
  }
  const M = 0.15
  return [minLng - M, minLat - M, maxLng + M, maxLat + M]
}

export function createCompositeProvider(opts: CompositeOptions): IsochroneProvider {
  const { leg, network } = opts
  const legMode: Mode = opts.legMode ?? 'cycling'
  const d = network.defaults

  let graph: MetroGraph | null = null
  let bbox: [number, number, number, number] | null = null
  const allStations: MetroStation[] = network.lines.flatMap((l) => l.stations)
  const stationById = new Map(allStations.map((s) => [s.id, s]))

  return {
    id: 'composite-metro',
    supportedModes: ['metro-cycling'],

    async fetch(req) {
      if (req.mode !== 'metro-cycling') {
        throw new Error(`组合等时圈只支持地铁+骑行，收到：${req.mode}`)
      }

      bbox ??= networkBBox(network)
      const [w, s0, e, n] = bbox
      const [lng, lat] = req.lngLat
      if (lng < w || lng > e || lat < s0 || lat > n) {
        throw new Error('「地铁+骑行」目前只覆盖深圳地铁线网范围，请把起点放在深圳，或换其他出行方式。')
      }

      const T = req.minutes

      // 直达区 + 进站档位圈并发取。直达区就是最大的一档接驳圈，
      // 进站估算把它一并当作最粗的档使用
      const accessMinutes = ACCESS_BUCKETS.filter((b) => b < T)
      const [direct, ...accessFeatures] = await Promise.all([
        leg.fetch({ lngLat: req.lngLat, mode: legMode, minutes: T }),
        ...accessMinutes.map((minutes) => leg.fetch({ lngLat: req.lngLat, mode: legMode, minutes })),
      ])

      const contours: AccessContour[] = accessMinutes.map((minutes, i) => ({
        minutes, feature: accessFeatures[i],
      }))
      const entries = estimateAccess(allStations, contours)

      graph ??= buildGraph(network)
      const reached = metroReachability(graph, entries, T, d.boardMin)

      // 出站：剩余时间向下分桶；同位置去重（换乘站在每条线是独立节点）后抽稀
      type Egress = { station: MetroStation; bucket: number }
      const byPlace = new Map<string, Egress>()
      for (const [stationId, spent] of reached) {
        const station = stationById.get(stationId)
        if (!station) continue
        const remaining = T - spent - d.exitMin
        const bucket = largestBucketAtMost(EGRESS_BUCKETS, remaining)
        if (bucket === null) continue
        const key = `${station.lngLat[0].toFixed(3)},${station.lngLat[1].toFixed(3)}`
        const prev = byPlace.get(key)
        if (!prev || bucket > prev.bucket) byPlace.set(key, { station, bucket })
      }

      const kept: Egress[] = []
      for (const eg of [...byPlace.values()].sort((a, b) => b.bucket - a.bucket)) {
        // 按档位从大到小遍历，已保留的档位都 ≥ 当前档——
        // 附近已有更大的圈时，这个圈是纯冗余
        const shadowed = kept.some((k) =>
          distance(point(k.station.lngLat), point(eg.station.lngLat)) < THIN_RADIUS_KM)
        if (!shadowed) kept.push(eg)
      }

      const egressFeatures = await Promise.all(kept.map(({ station, bucket }) =>
        leg.fetch({ lngLat: station.lngLat, mode: legMode, minutes: bucket })))

      const pieces = [direct, ...egressFeatures]
        .filter((f): f is PolyFeature => f !== null)
        .map(simplifyForOps)
      return normalize(pieces)
    },
  }
}
