/**
 * 「租房通勤」「生活探索」地图上的地点标记（Mapbox DOM Marker）。和「多点见面」的出发地标记同一造型：
 * 白底圆角方块、不描边、两层柔和投影；方块里放彩色图标（或一个字），编号放在右上角的识别色小圆牌里。
 * 样式见 components/MapView.css 的 .place-marker。
 */

/** 识别色：品牌靛紫（起点、公司）、玫瑰（候选住处、探索到的地点）、结果紫（当前选中） */
export type PlaceMarkerTone = 'brand' | 'explore' | 'result'

export type PlaceMarkerOptions = {
  /** 彩色图标地址；没有图标时改用 text */
  icon?: string
  /** 方块里的一个字（起、终），用识别色写 */
  text?: string
  /** 右上角圆牌里的编号或简称 */
  chip?: string
  tone: PlaceMarkerTone
  /** 直接指定识别色，覆盖 tone 的颜色（例如和地图上对应范围的填色保持一致） */
  color?: string
  /** 起点、公司这类锚点大一号 */
  large?: boolean
  /** 当前选中：大一号，外加一圈呼吸光环 */
  selected?: boolean
  title: string
  label: string
  onClick?: () => void
}

export function createPlaceMarkerElement(options: PlaceMarkerOptions): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = [
    'place-marker',
    `is-${options.tone}`,
    options.large || options.selected ? 'is-large' : '',
    options.selected ? 'is-selected' : '',
  ].filter(Boolean).join(' ')
  if (options.color) el.style.setProperty('--marker-tone', options.color)

  if (options.icon) {
    const image = document.createElement('img')
    image.src = options.icon
    image.alt = ''
    image.draggable = false
    image.setAttribute('aria-hidden', 'true')
    el.appendChild(image)
  } else if (options.text) {
    const text = document.createElement('span')
    text.className = 'place-marker-text'
    text.textContent = options.text
    el.appendChild(text)
  }
  if (options.chip) {
    const chip = document.createElement('span')
    chip.className = 'place-marker-chip'
    chip.textContent = options.chip
    el.appendChild(chip)
  }

  el.title = options.title
  el.setAttribute('aria-label', options.label)
  // 点标记不能冒泡成地图点击，否则会被当成「在地图上选点」
  el.onclick = event => {
    event.stopPropagation()
    options.onClick?.()
  }
  return el
}
