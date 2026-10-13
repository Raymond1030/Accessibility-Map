/** 地铁网络静态数据的形状，与 src/data/metro/*.json 对应（由 scripts/build-metro-data.mjs 生成） */

export type MetroStation = {
  id: string
  name: string
  /** WGS-84 */
  lngLat: [number, number]
}

export type MetroLine = {
  id: string
  name: string
  /** 班距（分钟），缺省用 defaults.headwayMin */
  headwayMin?: number
  stations: MetroStation[]
  /** 相邻区间运行时间（分钟），长度 = stations.length - 1；缺省按站间距离估算 */
  runTimesMin?: number[]
}

export type MetroDefaults = {
  /** 班距：候车期望值取它的一半 */
  headwayMin: number
  /** 换乘走行时间（不含候车） */
  transferMin: number
  /** 进站安检 + 到站台 */
  boardMin: number
  /** 下车到出站 */
  exitMin: number
  /** 每站停站时间，摊进区间用时 */
  dwellMin: number
  /** 区间估算速度（无 runTimesMin 时使用） */
  runSpeedKmph: number
}

export type MetroNetwork = {
  city: string
  crs: string
  defaults: MetroDefaults
  lines: MetroLine[]
}
