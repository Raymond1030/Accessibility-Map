/**
 * WGS-84 ↔ GCJ-02 坐标转换。
 *
 * ⚠️ 迁移到 Mapbox（全栈 WGS-84）后，本模块当前没有调用方。
 * 保留原因：README 记录的后续阶段（用高德距离测量 API 做国内驾车
 * 网格采样）需要它，且它有完整测试、零维护成本。
 *
 * GCJ-02（俗称火星坐标）的偏移算法未公开，这里用的是业界通行的逆向实现，
 * 往返误差在米级，对等时圈这个精度量级完全够用。
 */

const PI = 3.1415926535897932384626
/** 克拉索夫斯基椭球长半轴 */
const A = 6378245.0
/** 第一偏心率的平方 */
const EE = 0.00669342162296594323

/**
 * GCJ-02 只在中国国境内定义。境外坐标必须原样返回——
 * 强行套用偏移会把本来正确的坐标弄错。
 * 这是个粗略的矩形判断，边界地区可能误判，但对本应用足够：
 * 判错的后果只是偏移几百米，而非坐标完全失效。
 */
export function outOfChina(lng: number, lat: number): boolean {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
    + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
    + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

/** 计算某点处 WGS-84 → GCJ-02 的经纬度偏移量 */
function offset(lng: number, lat: number): [number, number] {
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return [dLng, dLat]
}

export function wgs84ToGcj02([lng, lat]: [number, number]): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  const [dLng, dLat] = offset(lng, lat)
  return [lng + dLng, lat + dLat]
}

/**
 * 反向转换。偏移量本身依赖坐标位置，所以严格反解没有闭式解；
 * 这里用「在原点处求偏移再减去」的一次近似，误差米级——
 * 阶段三接 OpenRouteService（WGS-84 路网）时会用到它。
 */
export function gcj02ToWgs84([lng, lat]: [number, number]): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  const [dLng, dLat] = offset(lng, lat)
  return [lng - dLng, lat - dLat]
}
