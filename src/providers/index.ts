import { createMapboxProvider } from './mapbox'
import { createMetroWalkingProvider } from './metroWalking'
import { createCompositeProvider } from './composite'
import { withCache } from './cache'
import { withGate } from './gate'
import { withTimeout } from './timeout'
import type { IsochroneProvider } from './cache'
import type { Mode } from '../types'
import type { MetroNetwork } from '../transit/types'
import shenzhenMetro from '../data/metro/shenzhen.json'
import { createLocalProvider, getLocalEngineUrl } from './local'

export type { IsochroneProvider, IsochroneRequest } from './cache'

let registry: IsochroneProvider[] | null = null
let registryUrl: string | null | undefined

/**
 * 三层顺序都有意义：
 *   缓存最外——命中缓存的请求根本不占用闸门名额
 *   超时最内——请求挂死时由它抛错，闸门才能释放并重试；
 *              包在闸门外层则闸门内部依然挂着，会死锁
 *
 * 组合 provider 是例外：它整体耗时由几十个腿级请求决定，超时和闸门
 * 都作用在腿上（它注入的正是下面这份 Mapbox 栈），顶层只包缓存。
 */
function buildRegistry(localUrl: string | null): IsochroneProvider[] {
  const mapbox = localUrl ? createLocalProvider(localUrl) : withCache(withGate(withTimeout(createMapboxProvider())))
  const metroWalking = createMetroWalkingProvider({ leg: mapbox, network: shenzhenMetro as unknown as MetroNetwork })
  const composite = createCompositeProvider({
    leg: mapbox,
    // JSON 导入把坐标推断成 number[]，而 schema 是 [number, number] 二元组
    network: shenzhenMetro as unknown as MetroNetwork,
  })
  return [mapbox, metroWalking, localUrl ? composite : withCache(composite)]
}

/** 按出行方式分发数据源：驾车/步行/骑行走 Mapbox，地铁+步行走本地网络，地铁+骑行走自建合成 */
export function getProvider(mode: Mode): IsochroneProvider {
  const localUrl = getLocalEngineUrl()
  if (!localUrl && mode === 'transit-walking') throw new Error('公交等时圈服务已停用，请配置本地引擎或选择地铁、驾车、骑行、步行。')
  if (localUrl && mode === 'driving-traffic') throw new Error('本地引擎没有实时路况数据，请选择静态驾车。')
  if (!registry || registryUrl !== localUrl) { registry = buildRegistry(localUrl); registryUrl = localUrl }
  const hit = registry.find((p) => p.supportedModes.includes(mode))
  if (!hit) throw new Error(`没有支持「${mode}」的数据源`)
  return hit
}
