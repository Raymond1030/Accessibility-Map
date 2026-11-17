import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, writeFile, mkdir, stat, lstat, rename } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGateway } from './gateway.mjs'
import { guardProcess } from './lifecycle.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const option = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1] }
const region = option('region', 'guangdong')
if (!['guangdong', 'hong-kong', 'macau'].includes(region)) throw new Error('Invalid --region')
const heap = option('heap', '3g')
if (!/^\d+[mg]$/i.test(heap)) throw new Error('--heap must look like 2g or 1536m')
const port = Number(option('port', '8787'))
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8989) throw new Error('Invalid --port')

async function hash(path) {
  const digest = createHash('sha256')
  for await (const block of createReadStream(path)) digest.update(block)
  return digest.digest('hex')
}
async function freePort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', () => reject(new Error(`Port ${port} is in use; stop the existing engine before starting another.`)))
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
}

const directory = join(root, '.local', region)
let manifest
try { manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) }
catch { throw new Error(`Prepare data first: python engine/prepare.py --region ${region}`) }
// Check the input identity before allowing the service to describe a graph as current.
for (const input of [manifest.jar, manifest.osm, ...manifest.gtfs, { path: manifest.configPath, sha256: manifest.configSha256 }]) {
  if (await hash(input.path) !== input.sha256) throw new Error(`Input changed: ${input.path}. Run preparation again before starting.`)
}
await freePort(8989)
await freePort(port)
await mkdir(directory, { recursive: true })
const temporaryDirectory = join(root, '.local', 'tmp')
await mkdir(temporaryDirectory, { recursive: true })
if (process.argv.includes('--rebuild')) {
  const expected = resolve(directory, 'graph-' + manifest.dataVersion)
  if (resolve(manifest.graphPath) !== expected) throw new Error('Refusing to rebuild a graph outside its expected region directory')
  const info = await lstat(expected).catch(() => null)
  if (info?.isSymbolicLink()) throw new Error('Refusing to move a symlink graph directory')
  if (info) {
    const archived = expected + '.previous-' + Date.now()
    await rename(expected, archived)
    console.log('Previous graph preserved at ' + archived)
  }
}
const stampPath = join(manifest.graphPath, 'accessibility-map-build.json')
const graphExists = await stat(join(manifest.graphPath, 'properties')).then(() => true, () => false)
if (graphExists) {
  const stamp = await readFile(stampPath, 'utf8').then(JSON.parse, () => null)
  if (stamp?.dataVersion !== manifest.dataVersion) throw new Error(`Graph was not started successfully with this manifest. Retry with --rebuild to preserve the old graph and import again: ${manifest.graphPath}`)
}
const log = createWriteStream(join(directory, 'graphhopper.log'), { flags: 'a' })
let ready = false
let stopping = false
let poll
let forceStop
const child = spawn(process.env.LOCAL_ENGINE_JAVA || 'java', ['-Xms128m', `-Xmx${heap}`, `-Djdk.net.unixdomain.tmpdir=${temporaryDirectory}`, '-XX:ActiveProcessorCount=2', '-cp', manifest.jar.path, join(root, 'EngineHost.java'), 'com.graphhopper.application.GraphHopperApplication', 'server', manifest.configPath], { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
child.stdin.on('error', () => { /* child may already have exited */ })
child.stdout.on('data', bytes => { if (!stopping) log.write(bytes); process.stdout.write(bytes) })
child.stderr.on('data', bytes => { if (!stopping) log.write(bytes); process.stderr.write(bytes) })
const gateway = createGateway({ manifest, isReady: () => ready && child.exitCode === null })
gateway.listen(port, '127.0.0.1', () => console.log(`Local API: http://127.0.0.1:${port} (${region}); GraphHopper is loading.`))
const shutdown = () => {
  if (stopping) return
  stopping = true
  ready = false
  process.stdin.pause()
  clearInterval(poll)
  gateway.closeAllConnections()
  gateway.close()
  // Windows child.kill() force-terminates Java and corrupts open GTFS MapDB files.
  // EOF also works when the supervisor unexpectedly exits and the OS closes its pipe.
  child.stdin.end()
  if (child.exitCode === null && child.signalCode === null) {
    forceStop = setTimeout(() => {
      console.error('Java did not close within 45 seconds; forcing termination. Rebuild may be required.')
      child.kill()
    }, 45000)
    forceStop.unref()
  }
}
guardProcess({ log, shutdown })
gateway.on('error', error => { console.error(error); shutdown(); process.exitCode = 1 })
child.on('error', error => { console.error('Cannot start Java:', error.message); shutdown(); log.end(); process.exitCode = 1 })
child.on('exit', code => { if (!stopping) { console.error(`GraphHopper exited (${code}); see ${join(directory, 'graphhopper.log')}`); process.exitCode = code || 1 }; shutdown(); clearTimeout(forceStop); log.end() })
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// A typed stop avoids terminal hosts that terminate an entire Windows process tree on Ctrl+C.
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  input += chunk
  const lines = input.split(/\r?\n/)
  input = lines.pop()
  if (lines.some(line => line.trim().toLowerCase() === 'stop')) shutdown()
})
console.log('To stop cleanly, type stop and press Enter. Wait for Java to exit before closing this terminal.')
let checking = false
poll = setInterval(async () => {
  if (checking || stopping || ready) return
  checking = true
  try {
    const response = await fetch('http://127.0.0.1:8989/info', { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return
    await mkdir(manifest.graphPath, { recursive: true })
    await writeFile(stampPath, JSON.stringify({ dataVersion: manifest.dataVersion, engineVersion: manifest.engine.version, readyAt: new Date().toISOString() }, null, 2))
    ready = true
    console.log(`READY: http://127.0.0.1:${port}/health | data ${manifest.dataVersion}`)
  } catch { /* expected during the first import; progress is in the GraphHopper log */ }
  finally { checking = false }
}, 1500)
