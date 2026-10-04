// Outside sources run by the bridge: the supervisor on a stand-in script, then the real source's
// lock and parent watch, then the whole path (a configured source showing up as a lane).

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { superviseSources } from '../../bridge/sources.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SOURCE = path.join(ROOT, 'sources', 'azure-metrics.mjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'undertone-sources-'))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
// Whatever a test starts goes when the file is done, even when an assertion or a wait failed first:
// a supervisor's file watch or a live child would otherwise keep the run from ever exiting
const cleanup = []
after(async () => { for (const f of cleanup.reverse()) { try { await f() } catch {} } })
const track = (child) => { cleanup.push(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }); return child }

async function until(fn, ms = 5000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting for ' + fn.toString())
    await sleep(40)
  }
}

test('the bridge starts sources when sources.json describes one, restarts them when it changes or they die, and stops them when it empties', async () => {
  const dir = tmp()
  const config = path.join(dir, 'sources.json')
  const script = path.join(dir, 'fake.mjs')
  fs.writeFileSync(script, "process.stdin.on('end', () => process.exit(0)); process.stdin.resume(); console.log('up ' + process.env.UNDERTONE_PORT)")
  const sup = superviseSources({ script, config, port: 4999, log: () => {}, watchMs: 50, againMs: 50, quickMs: 100, steadyMs: 60_000 })
  cleanup.push(() => sup.stop())
  assert.deepEqual(sup.status(), { configured: false, running: false, pid: null, restarts: 0, last: '' })

  fs.writeFileSync(config, JSON.stringify({ ourplace: { metrics: [] } }))
  const first = await until(() => sup.status().pid)
  await until(() => sup.status().last === 'up 4999')

  fs.writeFileSync(config, JSON.stringify({ ourplace: { label: 'changed', metrics: [] } }))
  const second = await until(() => { const p = sup.status().pid; return p && p !== first && p })
  await until(() => !alive(first))

  process.kill(second)
  const third = await until(() => { const p = sup.status().pid; return p && p !== second && p })
  assert.ok(sup.status().restarts >= 2)

  fs.writeFileSync(config, '{}')
  await until(() => !sup.status().running && !alive(third))
  assert.equal(sup.status().configured, false)

  fs.writeFileSync(config, JSON.stringify({ again: {} }))
  const fourth = await until(() => sup.status().pid)
  await sup.stop()
  await until(() => !alive(fourth))
  fs.writeFileSync(config, JSON.stringify({ after: {} }))
  await sleep(300)
  assert.equal(sup.status().running, false, 'nothing starts after stop')
})

test('the real source holds a lock, a second copy steps aside, and a bridge-run copy quits when its pipe closes', async () => {
  const home = tmp()
  const config = path.join(home, 'sources.json')
  fs.writeFileSync(config, JSON.stringify({ quiet: { label: 'quiet', metrics: [] } }))
  const env = { ...process.env, UNDERTONE_HOME: home, UNDERTONE_SOURCES_CONFIG: config, UNDERTONE_PORT: String(await freePort()) }
  const lock = path.join(home, 'sources.pid')

  const child = track(spawn(process.execPath, [SOURCE], { env: { ...env, UNDERTONE_SOURCES_CHILD: '1' }, stdio: ['pipe', 'ignore', 'ignore'] }))
  await until(() => fs.existsSync(lock) && Number(fs.readFileSync(lock, 'utf8')) === child.pid)

  const second = track(spawn(process.execPath, [SOURCE], { env, stdio: ['ignore', 'pipe', 'ignore'] }))
  let out = ''
  second.stdout.on('data', (d) => { out += d })
  const code = await new Promise((r) => second.on('exit', r))
  assert.equal(code, 0)
  assert.match(out, /already running \(pid \d+\)/)

  const gone = new Promise((r) => child.on('exit', r))
  child.stdin.end()
  assert.equal(await gone, 0)
  assert.ok(!fs.existsSync(lock), 'the lock goes with it')

  // A lock nobody has touched for three minutes is taken over, even if its pid is alive again
  fs.writeFileSync(lock, String(process.pid))
  const old = new Date(Date.now() - 10 * 60_000)
  fs.utimesSync(lock, old, old)
  const third = track(spawn(process.execPath, [SOURCE], { env: { ...env, UNDERTONE_SOURCES_CHILD: '1' }, stdio: ['pipe', 'ignore', 'ignore'] }))
  await until(() => Number(fs.readFileSync(lock, 'utf8')) === third.pid)
  const done = new Promise((r) => third.on('exit', r))
  third.stdin.end()
  await done
})

test('a source described in sources.json shows up as its own lane, run by the bridge alone', async () => {
  const home = tmp()
  const config = path.join(home, '.config', 'undertone', 'sources.json')
  fs.mkdirSync(path.dirname(config), { recursive: true })
  fs.writeFileSync(config, JSON.stringify({ quiet: { label: 'quiet prod', metrics: [] } }))
  const port = await freePort()
  const bridge = track(spawn(process.execPath, [path.join(ROOT, 'bridge', 'server.mjs'), String(port)], {
    env: { ...process.env, HOME: home, USERPROFILE: home, UNDERTONE_HOME: path.join(home, '.undertone'), UNDERTONE_SOURCES_CONFIG: config, UNDERTONE_SC_REPLY_PORT: '0', UNDERTONE_SCLANG: path.join(home, 'no-sclang'), GEMINI_API_KEY: '' },
    stdio: 'ignore',
  }))
  const url = 'http://127.0.0.1:' + port
  let pid
  try {
    const lane = await until(async () => {
      try { return (await (await fetch(url + '/state')).json()).lanes.find((l) => l.lane === 'src-quiet') } catch { return null }
    }, 10_000)
    assert.equal(lane.external, true)
    assert.equal(lane.label, 'quiet prod')
    const h = await (await fetch(url + '/health')).json()
    assert.equal(h.sources.running, true)
    assert.equal(h.sources.configured, true)
    pid = h.sources.pid
  } finally {
    await new Promise((r) => { bridge.once('exit', r); bridge.kill('SIGTERM') })
  }
  await until(() => !alive(pid), 5000)
})
