import type { MarkerIcon } from '../types'
import briefcaseUrl from '../assets/marker-icons/briefcase.svg'
import graduationCapUrl from '../assets/marker-icons/graduation-cap.svg'
import hospitalUrl from '../assets/marker-icons/hospital.svg'
import houseUrl from '../assets/marker-icons/house.svg'
import metroUrl from '../assets/marker-icons/metro.svg'
import roundPushpinUrl from '../assets/marker-icons/round-pushpin.svg'
import starUrl from '../assets/marker-icons/star.svg'
import steamingBowlUrl from '../assets/marker-icons/steaming-bowl.svg'

type MarkerIconOption = {
  id: MarkerIcon
  label: string
}

export const MARKER_ICON_OPTIONS: readonly MarkerIconOption[] = [
  { id: 'place', label: '地点' },
  { id: 'home', label: '住宅' },
  { id: 'work', label: '工作' },
  { id: 'school', label: '学校' },
  { id: 'transit', label: '交通' },
  { id: 'food', label: '餐饮' },
  { id: 'medical', label: '医疗' },
  { id: 'star', label: '收藏' },
] as const

const MARKER_ICON_IDS = new Set<MarkerIcon>(MARKER_ICON_OPTIONS.map((option) => option.id))

/** 旧数据可能没有 markerIcon；遇到未知值也安全回退到通用地点图标。 */
export function resolveMarkerIcon(icon: MarkerIcon | undefined): MarkerIcon {
  return icon && MARKER_ICON_IDS.has(icon) ? icon : 'place'
}

/**
 * 默认的「地点」只说明「这里有个点」，画个图形不带信息：地图标记和侧栏徽标都直接写字母代号。
 * 选了住宅、医疗等类型才画类型图标，字母退到角上的小圆牌里。
 */
export function markerShowsCode(icon: MarkerIcon | undefined): boolean {
  return resolveMarkerIcon(icon) === 'place'
}

/**
 * 「多点见面」出发地标记和侧栏选单用的彩色图标：Microsoft Fluent Emoji 的 Flat 版（MIT），
 * 放在白底方块上保持原色。来源、版本和授权见 src/assets/marker-icons/README.md。
 */
const MARKER_ICON_SRC: Record<MarkerIcon, string> = {
  place: roundPushpinUrl,
  home: houseUrl,
  work: briefcaseUrl,
  school: graduationCapUrl,
  transit: metroUrl,
  food: steamingBowlUrl,
  medical: hospitalUrl,
  star: starUrl,
}

export function markerIconSrc(icon: MarkerIcon | undefined): string {
  return MARKER_ICON_SRC[resolveMarkerIcon(icon)]
}

const loadedIconImages = new Map<MarkerIcon, HTMLImageElement>()
let iconImagesReady: Promise<void> | null = null

/**
 * 地图标记要在 canvas 上同步画图标，所以先把全部彩色图标解码成 Image 缓存起来。
 * 只加载一次；个别文件加载失败也照常 resolve，标记照画，只是缺这一个图标。
 */
export function loadMarkerIconImages(): Promise<void> {
  iconImagesReady ??= Promise.all(MARKER_ICON_OPTIONS.map(({ id }) => new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      loadedIconImages.set(id, image)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = MARKER_ICON_SRC[id]
  }))).then(() => undefined)
  return iconImagesReady
}

/** 已解码好的彩色图标；还没加载完时返回 undefined，调用方先画不带图标的标记，加载完再重画 */
export function markerIconImage(icon: MarkerIcon | undefined): HTMLImageElement | undefined {
  return loadedIconImages.get(resolveMarkerIcon(icon))
}

export function MarkerIconImage({ icon, className }: { icon: MarkerIcon | undefined; className?: string }) {
  return <img className={className} src={markerIconSrc(icon)} alt="" aria-hidden="true" draggable={false} />
}
