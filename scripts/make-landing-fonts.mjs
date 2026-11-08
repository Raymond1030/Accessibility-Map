// 生成首页用的思源黑体（Noto Sans SC）子集：只含首页组件里实际出现的字，400/500/700/900 四个字重。
// 用法：node scripts/make-landing-fonts.mjs
// 原理：Google Fonts CSS2 接口的 text= 参数会返回只含指定字符的 woff2；下载后放进 public/fonts 自托管，
// 线上页面不再请求 Google Fonts。改了首页文案后重新运行一次即可。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = ['src/components/Welcome.tsx', 'src/components/WelcomeGuide.tsx', 'src/components/WelcomeMap.tsx']
const WEIGHTS = [400, 500, 700, 900]

// 注释里的字不会显示，去掉以免子集变大
const stripComments = text => text
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const chars = new Set()
for (const file of sources) {
  for (const ch of stripComments(readFileSync(join(root, file), 'utf8'))) {
    if (ch.codePointAt(0) > 0x7e) chars.add(ch)
  }
}
for (let code = 0x20; code <= 0x7e; code++) chars.add(String.fromCharCode(code))
for (const ch of '，。、：；！？「」『』（）《》…—·／～＋％') chars.add(ch)
const text = [...chars].filter(ch => !/\s/.test(ch) || ch === ' ').sort().join('')
console.log(`共 ${chars.size} 个字符`)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const outDir = join(root, 'public/fonts')
mkdirSync(outDir, { recursive: true })
for (const weight of WEIGHTS) {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(text)}`
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/)
  if (!match) throw new Error(`字重 ${weight} 没有拿到 woff2：${css.slice(0, 200)}`)
  const font = Buffer.from(await (await fetch(match[1], { headers: { 'User-Agent': UA } })).arrayBuffer())
  if (font.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`字重 ${weight} 下载的不是 woff2`)
  const file = join(outDir, `noto-sans-sc-landing-${weight}.woff2`)
  writeFileSync(file, font)
  console.log(`${weight}：${(font.length / 1024).toFixed(1)} KB → ${file}`)
}
