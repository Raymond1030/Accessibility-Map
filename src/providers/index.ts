import { createAmapTransitProvider } from './amapTransit'
import { withCache } from './cache'
import { withGate } from './gate'
import type { IsochroneProvider } from './cache'

export type { IsochroneProvider, IsochroneRequest } from './cache'

let provider: IsochroneProvider | null = null

/** 顺序有意义：缓存在外，命中缓存的请求根本不占用闸门名额 */
export function getProvider(): IsochroneProvider {
  if (!provider) provider = withCache(withGate(createAmapTransitProvider()))
  return provider
}
