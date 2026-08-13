import { createMapboxProvider } from './mapbox'
import { withCache } from './cache'
import { withGate } from './gate'
import { withTimeout } from './timeout'
import type { IsochroneProvider } from './cache'

export type { IsochroneProvider, IsochroneRequest } from './cache'

let provider: IsochroneProvider | null = null

/**
 * 三层顺序都有意义：
 *   缓存最外——命中缓存的请求根本不占用闸门名额
 *   超时最内——请求挂死时由它抛错，闸门才能释放并重试；
 *              包在闸门外层则闸门内部依然挂着，会死锁
 */
export function getProvider(): IsochroneProvider {
  if (!provider) {
    provider = withCache(withGate(withTimeout(createMapboxProvider())))
  }
  return provider
}
