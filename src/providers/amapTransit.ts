import { loadAmap } from '../amap/loader'
import { describeConfigError } from '../amap/errors'
import {
  boundsToNormalizedFeature, interpretArrivalRangeResult, type AmapBounds,
} from './transform'
import { wgs84ToGcj02, gcj02ToWgs84 } from '../geo/coord'
import { MAX_MINUTES, type Mode } from '../types'
import type { IsochroneProvider } from './cache'

/**
 * 高德到达圈 provider——公共交通等时圈（含步行接驳）。
 * 这是全代码库唯一直接和 ArrivalRange 打交道的地方，对外只吐 WGS-84 规范 GeoJSON。
 *
 * ArrivalRange 的模型本身就是「公共交通 + 步行进出站」，
 * policy 只筛选交通工具：ALL=公交+地铁（高德缺省），SUBWAY=仅地铁。
 */
const POLICY: Partial<Record<Mode, string | null>> = {
  'transit-walking': null, // null = 用高德缺省（公交+地铁）
  'subway-walking': 'SUBWAY',
}

export function createAmapTransitProvider(): IsochroneProvider {
  return {
    id: 'amap-transit',
    supportedModes: ['transit-walking', 'subway-walking'],

    async fetch(req) {
      if (!(req.mode in POLICY)) {
        throw new Error(`高德到达圈只支持公交/地铁组合，收到：${req.mode}`)
      }
      if (req.minutes > MAX_MINUTES) {
        throw new Error(`时间档位超过上限 ${MAX_MINUTES} 分钟`)
      }

      const AMapNS = await loadAmap()
      const arrivalRange = new AMapNS.ArrivalRange()

      const policyValue = POLICY[req.mode]
      const opts = policyValue ? { policy: policyValue } : {}

      const bounds = await new Promise<AmapBounds>((resolve, reject) => {
        arrivalRange.search(
          // 高德吃 GCJ-02，全栈是 WGS-84，进出各转一次
          wgs84ToGcj02(req.lngLat),
          req.minutes,
          (status: string, result: unknown) => {
            const interpreted = interpretArrivalRangeResult(status, result)
            if (interpreted.ok) resolve(interpreted.bounds)
            else reject(new Error(`高德到达圈请求失败：${describeConfigError(interpreted.error)}`))
          },
          opts,
        )
      })

      // 空 bounds 表示该点周边无公交可达数据——有效结果，不是错误
      return boundsToNormalizedFeature(bounds, gcj02ToWgs84)
    },
  }
}
