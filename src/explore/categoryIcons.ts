import type { CategoryId } from './types'
import booksUrl from '../assets/marker-icons/books.svg'
import barberPoleUrl from '../assets/marker-icons/barber-pole.svg'
import classicalBuildingUrl from '../assets/marker-icons/classical-building.svg'
import convenienceStoreUrl from '../assets/marker-icons/convenience-store.svg'
import deciduousTreeUrl from '../assets/marker-icons/deciduous-tree.svg'
import hotBeverageUrl from '../assets/marker-icons/hot-beverage.svg'
import openBookUrl from '../assets/marker-icons/open-book.svg'
import personLiftingWeightsUrl from '../assets/marker-icons/person-lifting-weights.svg'
import pillUrl from '../assets/marker-icons/pill.svg'
import shoppingBagsUrl from '../assets/marker-icons/shopping-bags.svg'
import shoppingCartUrl from '../assets/marker-icons/shopping-cart.svg'
import steamingBowlUrl from '../assets/marker-icons/steaming-bowl.svg'

/** 生活探索各类地点在地图上的彩色图标（Fluent Emoji；来源与授权见 src/assets/marker-icons/README.md） */
export const CATEGORY_ICON: Record<CategoryId, string> = {
  mall: shoppingBagsUrl,
  salon: barberPoleUrl,
  supermarket: shoppingCartUrl,
  park: deciduousTreeUrl,
  convenience: convenienceStoreUrl,
  food: steamingBowlUrl,
  cafe: hotBeverageUrl,
  fitness: personLiftingWeightsUrl,
  pharmacy: pillUrl,
  bookstore: booksUrl,
  library: openBookUrl,
  museum: classicalBuildingUrl,
}

/** 旧缓存里可能有不认识的类别：返回 undefined，调用方改写编号 */
export function categoryIcon(category: string | undefined): string | undefined {
  return category && category in CATEGORY_ICON ? CATEGORY_ICON[category as CategoryId] : undefined
}
