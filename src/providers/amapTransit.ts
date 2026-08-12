import { loadAmap } from '../amap/loader'
import {
  boundsToNormalizedFeature, interpretArrivalRangeResult, type AmapPath,
} from './transform'
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
          (status: string, result: unknown) => {
            const interpreted = interpretArrivalRangeResult(status, result)
            if (interpreted.ok) resolve(interpreted.bounds)
            else reject(new Error(`高德到达圈请求失败：${interpreted.error}`))
          },
          policy,
        )
      })

      // 空 bounds 表示该点周边无公交可达数据——有效结果，不是错误
      return boundsToNormalizedFeature(bounds)
    },
  }
}
