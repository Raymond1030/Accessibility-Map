import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', ...process.argv.slice(2)], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, VITE_LOCAL_ENGINE_URL: process.env.VITE_LOCAL_ENGINE_URL || 'http://127.0.0.1:8787' },
})
child.on('exit', code => { process.exitCode = code ?? 1 })
child.on('error', error => { console.error(error); process.exitCode = 1 })
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
