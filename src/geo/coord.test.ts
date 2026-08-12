import { describe, it, expect } from 'vitest'
import { wgs84ToGcj02, gcj02ToWgs84, outOfChina } from './coord'

/** 两点间的粗略米距，用于断言偏移量级而非精确坐标 */
function metersBetween(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat = toRad((a[1] + b[1]) / 2)
  const x = dLng * Math.cos(lat)
  return Math.sqrt(x * x + dLat * dLat) * R
}

describe('outOfChina', () => {
  it('北京在境内', () => {
    expect(outOfChina(116.397, 39.909)).toBe(false)
  })

  it('深圳在境内', () => {
    expect(outOfChina(113.94, 22.53)).toBe(false)
  })

  it('东京在境外', () => {
    expect(outOfChina(139.767, 35.681)).toBe(true)
  })

  it('纽约在境外', () => {
    expect(outOfChina(-74.006, 40.713)).toBe(true)
  })
})

describe('wgs84ToGcj02', () => {
  it('境内坐标会偏移，量级在数百米——这正是不转换就会错的距离', () => {
    const wgs: [number, number] = [116.397, 39.909]
    const gcj = wgs84ToGcj02(wgs)
    const d = metersBetween(wgs, gcj)
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(1000)
  })

  it('偏移方向：GCJ-02 在 WGS-84 的东北侧（中国大陆普遍如此）', () => {
    const [lng, lat] = wgs84ToGcj02([116.397, 39.909])
    expect(lng).toBeGreaterThan(116.397)
    expect(lat).toBeGreaterThan(39.909)
  })

  it('深圳同样偏移', () => {
    const wgs: [number, number] = [113.9435, 22.5333]
    const d = metersBetween(wgs, wgs84ToGcj02(wgs))
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(1000)
  })

  it('境外坐标原样返回——GCJ-02 只在国境内定义，强行偏移会把对的弄错', () => {
    const tokyo: [number, number] = [139.767, 35.681]
    expect(wgs84ToGcj02(tokyo)).toEqual(tokyo)
  })

  it('同样输入总得到同样输出', () => {
    expect(wgs84ToGcj02([116.397, 39.909])).toEqual(wgs84ToGcj02([116.397, 39.909]))
  })
})

describe('gcj02ToWgs84', () => {
  it('往返转换后回到原点附近，误差在米级', () => {
    const wgs: [number, number] = [116.397, 39.909]
    const back = gcj02ToWgs84(wgs84ToGcj02(wgs))
    expect(metersBetween(wgs, back)).toBeLessThan(2)
  })

  it('深圳往返同样收敛', () => {
    const wgs: [number, number] = [113.9435, 22.5333]
    const back = gcj02ToWgs84(wgs84ToGcj02(wgs))
    expect(metersBetween(wgs, back)).toBeLessThan(2)
  })

  it('境外坐标原样返回', () => {
    const tokyo: [number, number] = [139.767, 35.681]
    expect(gcj02ToWgs84(tokyo)).toEqual(tokyo)
  })
})

describe('边界与异常输入', () => {
  it('赤道与本初子午线不崩溃', () => {
    const r = wgs84ToGcj02([0, 0])
    expect(Number.isFinite(r[0])).toBe(true)
    expect(Number.isFinite(r[1])).toBe(true)
  })

  it('极点不产生 NaN', () => {
    const r = wgs84ToGcj02([0, 89.9])
    expect(Number.isFinite(r[0])).toBe(true)
    expect(Number.isFinite(r[1])).toBe(true)
  })

  it('国界附近的境内点仍会转换', () => {
    const nearBorder: [number, number] = [74.0, 40.0]
    expect(wgs84ToGcj02(nearBorder)).not.toEqual(nearBorder)
  })
})
