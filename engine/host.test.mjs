import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

test('closing the supervisor pipe runs real Java shutdown hooks before exit', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'accessibility-java-'))
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    await rm(directory, { recursive: true, force: true })
  })
  const fixture = join(directory, 'ShutdownFixture.java')
  const marker = join(directory, 'closed.txt')
  await writeFile(fixture, `import java.nio.file.*;
public class ShutdownFixture {
  public static void main(String[] args) throws Exception {
    Runtime.getRuntime().addShutdownHook(new Thread(() -> { try { Files.writeString(Path.of(args[0]), "closed"); } catch (Exception e) { throw new RuntimeException(e); } }));
    System.out.println("FIXTURE_READY");
    Thread.sleep(Long.MAX_VALUE);
  }
}`)
  const java = process.env.LOCAL_ENGINE_JAVA || 'java'
  const javac = process.env.LOCAL_ENGINE_JAVA ? join(dirname(java), process.platform === 'win32' ? 'javac.exe' : 'javac') : 'javac'
  await promisify(execFile)(javac, ['-d', directory, fixture], { windowsHide: true })
  const host = join(dirname(fileURLToPath(import.meta.url)), 'EngineHost.java')
  const child = spawn(java, ['-cp', directory, host, 'ShutdownFixture', marker], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  let output = ''
  child.stdout.on('data', data => { output += data; if (output.includes('FIXTURE_READY')) child.stdin.end() })
  child.stderr.on('data', data => { output += data })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, output)
  assert.equal(await readFile(marker, 'utf8'), 'closed')
})
