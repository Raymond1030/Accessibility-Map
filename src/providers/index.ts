import { createMapboxProvider } from './mapbox'
import { createAmapTransitProvider } from './amapTransit'
import { createCompositeProvider } from './composite'
import { withCache } from './cache'
import { withGate } from './gate'
import { withTimeout } from './timeout'
import type { IsochroneProvider } from './cache'
import type { Mode } from '../types'
import type { MetroNetwork } from '../transit/types'
import shenzhenMetro from '../data/metro/shenzhen.json'

export type { IsochroneProvider, IsochroneRequest } from './cache'

let registry: IsochroneProvider[] | null = null

/**
 * 三层顺序都有意义：
 *   缓存最外——命中缓存的请求根本不占用闸门名额
 *   超时最内——请求挂死时由它抛错，闸门才能释放并重试；
 *              包在闸门外层则闸门内部依然挂着，会死锁
 *
 * 组合 provider 是例外：它整体耗时由几十个腿级请求决定，超时和闸门
 * 都作用在腿上（它注入的正是下面这份 Mapbox 栈），顶层只包缓存。
 */
function buildRegistry(): IsochroneProvider[] {
  const mapbox = withCache(withGate(withTimeout(createMapboxProvider())))
  const amapTransit = withCache(withGate(withTimeout(createAmapTransitProvider())))
  const composite = withCache(createCompositeProvider({
    leg: mapbox,
    // JSON 导入把坐标推断成 number[]，而 schema 是 [number, number] 二元组
    network: shenzhenMetro as unknown as MetroNetwork,
  }))
  return [mapbox, amapTransit, composite]
}

/** 按出行方式分发数据源：驾车/步行/骑行走 Mapbox，公交/地铁组合走高德，地铁+骑行走自建合成 */
export function getProvider(mode: Mode): IsochroneProvider {
  registry ??= buildRegistry()
  const hit = registry.find((p) => p.supportedModes.includes(mode))
  if (!hit) throw new Error(`没有支持「${mode}」的数据源`)
  return hit
}
