import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter, once } from 'node:events'
import { guardProcess } from './lifecycle.mjs'

test('an actual log open failure stops the owned child and marks failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'accessibility-log-'))
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })
  const exited = once(child, 'exit')
  const host = new EventEmitter()
  const errors = []
  const log = createWriteStream(directory)
  guardProcess({ host, log, shutdown: () => child.kill(), report: error => errors.push(error) })
  t.after(async () => { child.kill(); await rmdir(directory) })
  await exited
  assert.equal(host.exitCode, 1)
  assert.equal(errors.length, 1)
})

test('unexpected supervisor termination invokes synchronous child cleanup', () => {
  const host = new EventEmitter()
  let stopped = 0
  guardProcess({ host, log: new EventEmitter(), shutdown: () => { stopped++ }, report: () => {} })
  host.emit('uncaughtExceptionMonitor', new Error('unexpected'))
  host.emit('exit', 1)
  assert.equal(stopped, 2)
})
