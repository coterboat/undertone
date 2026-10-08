// The bridge, run for real: each test starts it on a free port with HOME and UNDERTONE_HOME in a
// temp folder, and points phone pings at a fake ntfy server on localhost.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'undertone-bridge-'))

function writeNtfy(home, cfg, mode = 0o600) {
  const dir = path.join(home, '.config', 'undertone')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'ntfy.json')
  fs.writeFileSync(file, JSON.stringify(cfg))
  fs.chmodSync(file, mode)
}

async function fakeNtfy() {
  const got = []
  const srv = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => { got.push({ headers: req.headers, body: JSON.parse(b || '{}') }); res.writeHead(200).end('{}') })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { url: 'http://127.0.0.1:' + srv.address().port, got, close: () => srv.close() }
}

// A request with any Host header (fetch can't set one)
function raw(port, method, p, { host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: host || '127.0.0.1:' + port, ...headers } }, (res) => {
      if (p === '/events' && res.statusCode === 200) { resolve({ status: 200 }); req.destroy(); return }
      let t = ''
      res.on('data', (c) => { t += c })
      res.on('end', () => resolve({ status: res.statusCode, text: t }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// Every bridge a test starts goes when the file is done, even after a failed assertion
const children = new Set()
after(() => { for (const c of children) try { c.kill('SIGKILL') } catch {} })

const envFor = (home, env) => ({ ...process.env, HOME: home, USERPROFILE: home, UNDERTONE_HOME: path.join(home, '.undertone'), UNDERTONE_SOURCES_CONFIG: path.join(home, '.config', 'undertone', 'sources.json'), UNDERTONE_SC_REPLY_PORT: '0', UNDERTONE_SCLANG: path.join(home, 'no-sclang'), GEMINI_API_KEY: '', UNDERTONE_NTFY_TOKEN: '', ...env })

async function bridge({ home = tmpHome(), env = {}, args = [], port: fixed } = {}) {
  const port = fixed || (await freePort())
  const child = spawn(process.execPath, [path.join(ROOT, 'bridge', 'server.mjs'), String(port), ...args], {
    env: envFor(home, env),
    stdio: 'ignore',
  })
  children.add(child)
  let exitCode = null
  const exited = new Promise((r) => child.once('exit', (code) => { exitCode = code; r(code) }))
  const url = 'http://127.0.0.1:' + port
  for (let i = 0; i < 100 && exitCode === null; i++) {
    try { if ((await fetch(url + '/health')).ok) break } catch {}
    await sleep(50)
  }
  const json = (r) => r.json()
  return {
    port, home, url,
    post: (events) => fetch(url + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(events) }),
    state: () => fetch(url + '/state').then(json),
    health: () => fetch(url + '/health').then(json),
    exited, running: () => exitCode === null,
    stop: () => { if (exitCode === null) child.kill('SIGTERM'); return exited },
  }
}
const shutdown = (port, body = '{}') => raw(port, 'POST', '/shutdown', { headers: { 'content-type': 'application/json' }, body })
const within = (p, ms) => Promise.race([p, sleep(ms).then(() => 'still running')])

const lane = (id, extra = {}) => ({ lane: id, project: 'jobsnearme', label: 'jobsnearme · lane-2', ...extra })
const listFiles = (dir) => { try { return fs.readdirSync(dir) } catch { return [] } }

test('only requests addressed to the bridge itself are answered; nothing is logged, saved or sent for the rest', async () => {
  const ntfy = await fakeNtfy()
  const home = tmpHome()
  writeNtfy(home, { server: ntfy.url, topic: 'undertone-test-topic-0001', permissionAfterSec: 0.2 })
  const b = await bridge({ home })
  const evil = 'evil.example:' + b.port
  const body = JSON.stringify([{ type: 'session.start', ...lane('evil0001') }, { type: 'attention', reason: 'permission', ...lane('evil0001', { label: 'Approve at https://evil.example' }) }])
  for (const [method, p] of [['GET', '/'], ['GET', '/events'], ['GET', '/health'], ['GET', '/state'], ['GET', '/sc/log'], ['GET', '/sc/meter'], ['POST', '/event'], ['POST', '/sc'], ['POST', '/sc/start'], ['POST', '/ear'], ['POST', '/notify/test']]) {
    const r = await raw(b.port, method, p, { host: evil, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? body : undefined })
    assert.equal(r.status, 421, method + ' ' + p)
  }
  await sleep(500)
  assert.deepEqual(listFiles(path.join(home, '.undertone', 'log')), [])
  assert.deepEqual(listFiles(path.join(home, '.undertone', 'ear')), [])
  assert.equal(ntfy.got.length, 0)

  for (const host of ['127.0.0.1:' + b.port, 'localhost:' + b.port]) {
    for (const p of ['/', '/health', '/state', '/sc/log', '/sc/meter', '/events']) assert.equal((await raw(b.port, 'GET', p, { host })).status, 200, host + p)
  }
  assert.equal((await raw(b.port, 'POST', '/event', { headers: { 'content-type': 'application/json' }, body: '[]' })).status, 204)
  assert.equal((await raw(b.port, 'POST', '/event', { headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '[]' })).status, 403)
  assert.equal((await raw(b.port, 'POST', '/event', { headers: { 'content-type': 'application/json', origin: 'http://localhost:' + b.port }, body: '[]' })).status, 204)
  assert.equal((await raw(b.port, 'POST', '/notify/test', { headers: { 'content-type': 'application/json' } })).status, 200)
  assert.equal(ntfy.got.length, 1, 'the test ping goes out from an allowed host')
  await b.stop()
  ntfy.close()
})

test('a name in hosts.json (say, the Mac under tailscale serve) is answered too, posts only from that https origin, and its page runs live', async () => {
  const home = tmpHome()
  const dir = path.join(home, '.config', 'undertone')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'hosts.json')
  fs.writeFileSync(file, JSON.stringify({ hosts: ['Mac.tail0000.ts.net'] }))
  const b = await bridge({ home })
  const name = 'mac.tail0000.ts.net'

  for (const p of ['/', '/health', '/state', '/events']) assert.equal((await raw(b.port, 'GET', p, { host: name })).status, 200, name + p)
  assert.equal((await raw(b.port, 'GET', '/health', { host: name + ':8443' })).status, 200, 'on another port too')
  assert.match((await raw(b.port, 'GET', '/', { host: name })).text, /<meta name="undertone-bridge"/)
  assert.match((await raw(b.port, 'GET', '/')).text, /<meta name="undertone-bridge"/)
  for (const host of ['other.tail0000.ts.net', 'mac.tail0000.ts.net.evil.example', 'evil.example:' + b.port]) {
    assert.equal((await raw(b.port, 'GET', '/health', { host })).status, 421, host)
  }

  const post = (host, origin) => raw(b.port, 'POST', '/event', { host, headers: { 'content-type': 'application/json', origin }, body: '[]' })
  assert.equal((await post(name, 'https://' + name)).status, 204)
  assert.equal((await post(name + ':8443', 'https://' + name + ':8443')).status, 204)
  assert.equal((await post(name, 'http://' + name)).status, 403, 'only the https origin')
  assert.equal((await post(name, 'https://evil.example')).status, 403)
  assert.equal((await post('127.0.0.1:' + b.port, 'https://' + name)).status, 403, 'a local address takes local origins only')

  fs.writeFileSync(file, JSON.stringify({ hosts: [] }))
  assert.equal((await raw(b.port, 'GET', '/health', { host: name })).status, 421, 'read fresh: an emptied list refuses the name again')
  fs.writeFileSync(file, '{ not json')
  assert.equal((await raw(b.port, 'GET', '/health', { host: name })).status, 421, 'a broken file allows nothing extra')
  assert.equal((await raw(b.port, 'GET', '/health')).status, 200)
  await b.stop()
})

test('a session waiting on a permission prompt is needs_ok in /state, and still is after the bridge restarts', async () => {
  const home = tmpHome()
  let b = await bridge({ home })
  await b.post([{ type: 'session.start', ...lane('state001') }, { type: 'fail', check: 'test', ...lane('state001') }, { type: 'attention', reason: 'permission', ...lane('state001') }])
  let s = (await b.state()).lanes.find((l) => l.lane === 'state001')
  assert.equal(s.state, 'needs_ok')
  assert.deepEqual(s.failingChecks, ['test'])
  await b.stop() // straight away: a stop waits for the log, in order (it used to race the appends)
  b = await bridge({ home })
  s = (await b.state()).lanes.find((l) => l.lane === 'state001')
  assert.equal(s && s.state, 'needs_ok')
  assert.deepEqual(s.failingChecks, ['test'])
  await b.stop()
})

test('phone pings: the title per "names", a token when set, only for known Claude Code lanes, at most one per lane per gap', async () => {
  const ntfy = await fakeNtfy()
  const home = tmpHome()
  const base = { server: ntfy.url, topic: 'undertone-test-topic-0002', permissionAfterSec: 0.2, idleAfterSec: 0.2 }
  writeNtfy(home, { ...base, names: 'full', token: 'tok-123' })
  const b = await bridge({ home })
  const ask = async (id, extra = {}, reason = 'permission') => {
    await b.post([{ type: 'session.start', ...lane(id, extra) }, { type: 'attention', reason, ...lane(id, extra) }])
    await sleep(500)
  }

  await ask('full0001')
  assert.equal(ntfy.got.length, 1)
  assert.equal(ntfy.got[0].body.title, 'jobsnearme · lane-2 needs your OK')
  assert.equal(ntfy.got[0].headers.authorization, 'Bearer tok-123')
  assert.deepEqual(Object.keys(ntfy.got[0].body).sort(), ['message', 'priority', 'tags', 'title', 'topic'])

  writeNtfy(home, { ...base, names: 'project' })
  await ask('proj0001')
  assert.equal(ntfy.got[1].body.title, 'jobsnearme needs your OK')
  assert.equal(ntfy.got[1].headers.authorization, undefined)

  writeNtfy(home, { ...base, names: 'none' })
  await ask('none0001', {}, 'idle')
  assert.equal(ntfy.got[2].body.title, 'A session is waiting for you')

  // Unknown lanes and outside sources never ping
  await b.post([{ type: 'attention', reason: 'permission', ...lane('ghost001') }])
  await ask('src-ourplace', { origin: 'azure' })
  await sleep(300)
  assert.equal(ntfy.got.length, 3)

  // A second call from the same lane inside the gap is dropped and counted
  await b.post([{ type: 'tool', tool: 'Bash', ...lane('full0001') }, { type: 'attention', reason: 'permission', ...lane('full0001') }])
  await sleep(500)
  assert.equal(ntfy.got.length, 3)
  assert.equal((await b.health()).notify.dropped, 1)

  // A scheduled run: no ping for idle, a ping for a blocking permission prompt
  await b.post([{ type: 'session.start', ...lane('sched001') }, { type: 'prompt', scheduled: true, ...lane('sched001') }, { type: 'attention', reason: 'idle', scheduled: true, ...lane('sched001') }])
  await sleep(500)
  assert.equal(ntfy.got.length, 3)
  await b.post([{ type: 'attention', reason: 'permission', scheduled: true, ...lane('sched001') }])
  await sleep(500)
  assert.equal(ntfy.got.length, 4)
  await b.stop()
  ntfy.close()
})

test('phone pings refuse an unsafe setup and say why', async () => {
  const ntfy = await fakeNtfy()
  const home = tmpHome()
  const base = { server: ntfy.url, topic: 'undertone-test-topic-0003', permissionAfterSec: 0.2 }
  const b = await bridge({ home })
  const cases = [
    [{ ...base, server: 'http://ntfy.example' }, 0o600, /https/],
    [base, 0o644, /chmod 600/],
    [{ ...base, enabled: false }, 0o600, /turned off/],
    [{ ...base, topic: 'short' }, 0o600, /guessed/],
  ].filter(([, mode]) => process.platform !== 'win32' || mode === 0o600) // Windows has no chmod; the bridge skips that check there
  for (const [i, [cfg, mode, reason]] of cases.entries()) {
    writeNtfy(home, cfg, mode)
    await b.post([{ type: 'session.start', ...lane('unsafe0' + i) }, { type: 'attention', reason: 'permission', ...lane('unsafe0' + i) }])
    await sleep(400)
    const n = (await b.health()).notify
    assert.equal(n.ok, false)
    assert.match(n.reason, reason)
  }
  assert.equal(ntfy.got.length, 0)
  await b.stop()
  ntfy.close()
})

test('a lane that goes silent before its idle ping is due never pings', async () => {
  const ntfy = await fakeNtfy()
  const home = tmpHome()
  writeNtfy(home, { server: ntfy.url, topic: 'undertone-test-topic-0004', idleAfterSec: 2.5 })
  const b = await bridge({ home, env: { UNDERTONE_LANE_TTL_MS: '1000' } })
  await b.post([{ type: 'session.start', ...lane('stale001') }, { type: 'attention', reason: 'idle', ...lane('stale001') }])
  await sleep(3200)
  assert.equal((await b.state()).lanes.find((l) => l.lane === 'stale001'), undefined)
  assert.equal(ntfy.got.length, 0)
  await b.stop()
  ntfy.close()
})

test('old clips and logs go only when the days are set, and their index lines are marked', async () => {
  const home = tmpHome()
  const u = path.join(home, '.undertone')
  const today = new Date()
  const ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
  for (const d of ['2020-01-01', ymd]) {
    fs.mkdirSync(path.join(u, 'ear', d, '101010-synth-love'), { recursive: true })
    fs.mkdirSync(path.join(u, 'log'), { recursive: true })
    fs.writeFileSync(path.join(u, 'log', d + '.jsonl'), '')
  }
  fs.writeFileSync(path.join(u, 'ear', 'index.jsonl'), JSON.stringify({ dir: path.join(u, 'ear', '2020-01-01', '101010-synth-love') }) + '\n')
  let b = await bridge({ home })
  await b.stop()
  assert.ok(fs.existsSync(path.join(u, 'ear', '2020-01-01')), 'kept by default')
  b = await bridge({ home, env: { UNDERTONE_EAR_DAYS: '30', UNDERTONE_LOG_DAYS: '30' } })
  await b.stop()
  assert.ok(!fs.existsSync(path.join(u, 'ear', '2020-01-01')))
  assert.ok(!fs.existsSync(path.join(u, 'log', '2020-01-01.jsonl')))
  assert.ok(fs.existsSync(path.join(u, 'ear', ymd)))
  assert.ok(fs.existsSync(path.join(u, 'log', ymd + '.jsonl')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(u, 'ear', 'index.jsonl'), 'utf8').trim()).pruned, true)
})

test('a reaction with audio that is not a WAV is refused and leaves no folder behind', async () => {
  const home = tmpHome()
  const b = await bridge({ home })
  for (const wav of ['not base64 at all!!', Buffer.from('RIFF....not a wave file').toString('base64')]) {
    const r = await fetch(b.url + '/ear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'grates', state: { engine: 'synth' }, wav }) })
    assert.equal(r.status, 500)
  }
  assert.deepEqual(listFiles(path.join(home, '.undertone', 'ear')).filter((n) => !n.startsWith('.')), [])
  await b.stop()
})

test('a bridge started on its own leaves after a quiet spell; a Claude session keeps it, an outside source alone does not', async () => {
  const b = await bridge({ args: ['--auto'], env: { UNDERTONE_IDLE_EXIT_MIN: '0.01' } })
  assert.deepEqual((await b.health()).lifetime.auto, true)
  await b.post([{ type: 'session.start', ...lane('aaaa0001') }, { type: 'pulse', count: 2, lane: 'src-x', project: 'x', origin: 'azure' }])
  assert.equal(await within(b.exited, 1500), 'still running', 'a Claude session keeps it')
  await b.post([{ type: 'session.end', ...lane('aaaa0001') }])
  assert.equal(await within(b.exited, 3000), 0, 'quiet once only the outside source is left')
})

// A stand-in for sclang on a free port: answers a ping as the real one does and keeps every message
async function fakeSc() {
  const got = []
  const sock = dgram.createSocket('udp4')
  sock.on('message', (msg, from) => {
    let i = msg.indexOf(0)
    const address = msg.toString('utf8', 0, i)
    i += 4 - (i % 4)
    const tagEnd = msg.indexOf(0, i)
    const tags = msg.toString('ascii', i + 1, tagEnd)
    i = tagEnd + (4 - (tagEnd % 4))
    const args = []
    for (const t of tags) {
      if (t === 'f') { args.push(msg.readFloatBE(i)); i += 4 }
      else if (t === 's') { const e = msg.indexOf(0, i); args.push(msg.toString('utf8', i, e)); i = e + (4 - (e % 4)) }
    }
    got.push({ address, args })
    if (address === '/ut/ping') sock.send(Buffer.from('/ut/pong\0\0\0\0,\0\0\0'), from.port, from.address)
  })
  await new Promise((r) => sock.bind(0, '127.0.0.1', r))
  return { port: sock.address().port, got, close: () => sock.close() }
}

// A page listening on /events, until it's closed
const openPage = (port) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => res.once('data', () => resolve({ close: () => req.destroy() })))
  req.on('error', reject)
})

test('SuperCollider is silenced once no page is listening, so a closed tab leaves no sour note behind; a reload keeps it playing', async () => {
  const sc = await fakeSc()
  const b = await bridge({ env: { UNDERTONE_SC_PORT: String(sc.port), UNDERTONE_SC_ORPHAN_MS: '300' } })
  const released = () => sc.got.filter((m) => m.address === '/ut/sour' && m.args[1] === 'off')
  try {
    let page = await openPage(b.port)
    assert.equal((await fetch(b.url + '/sc/start', { method: 'POST' })).status, 200)
    await fetch(b.url + '/sc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ k: 'sour', s: 'on', m: 66, d: 0.02 }]) })

    // A reload: the old page goes and the new one is listening well inside the wait
    page.close()
    page = await openPage(b.port)
    await sleep(900)
    assert.deepEqual(released(), [], 'a reload releases nothing')

    page.close()
    for (let i = 0; i < 50 && !released().length; i++) await sleep(50)
    assert.equal(released().length, 1, 'the held sour note is let go')
    const last = (address) => sc.got.findLast((m) => m.address === address)
    assert.equal(last('/ut/level')?.args[0], 0)
    assert.equal(last('/ut/drone')?.args[0], 0)
  } finally {
    sc.close()
    await b.stop()
  }
})

test("the page's tempo reaches SuperCollider, which times its echo to it, kept to a sane range", async () => {
  const sc = await fakeSc()
  const b = await bridge({ env: { UNDERTONE_SC_PORT: String(sc.port) } })
  const tempos = () => sc.got.filter((m) => m.address === '/ut/tempo').map((m) => m.args.map((a) => Math.round(a * 100) / 100))
  try {
    await fetch(b.url + '/sc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ k: 'tempo', bpm: 90, d: 0.1 }, { k: 'tempo', bpm: 9000, d: 0.1 }]) })
    for (let i = 0; i < 50 && tempos().length < 2; i++) await sleep(20)
    assert.deepEqual(tempos(), [[0.1, 90], [0.1, 300]])
  } finally {
    sc.close()
    await b.stop()
  }
})

test("the Mix's SuperCollider synths level reaches SuperCollider, kept to 0-2", async () => {
  const sc = await fakeSc()
  const b = await bridge({ env: { UNDERTONE_SC_PORT: String(sc.port) } })
  const levels = () => sc.got.filter((m) => m.address === '/ut/synths').map((m) => Math.round(m.args[0] * 100) / 100)
  try {
    await fetch(b.url + '/sc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ k: 'synths', a: 0.5 }, { k: 'synths', a: 9 }, { k: 'synths', a: -1 }]) })
    for (let i = 0; i < 50 && levels().length < 3; i++) await sleep(20)
    assert.deepEqual(levels(), [0.5, 2, 0])
  } finally {
    sc.close()
    await b.stop()
  }
})

test('a bridge started by hand never leaves on its own', async () => {
  const b = await bridge({ env: { UNDERTONE_IDLE_EXIT_MIN: undefined } })
  const h = await b.health()
  assert.deepEqual([h.lifetime.auto, h.lifetime.idleExitMin], [false, 0])
  assert.equal(await within(b.exited, 800), 'still running')
  await b.stop()
})

test('/shutdown sticky keeps auto-starts away until a deliberate start lifts it', async () => {
  const home = tmpHome()
  const first = await bridge({ home })
  assert.equal((await shutdown(first.port, '{"sticky":true}')).status, 202)
  assert.equal(await within(first.exited, 3000), 0)
  assert.ok(fs.existsSync(path.join(home, '.undertone', 'stopped')))

  const auto = await bridge({ home, args: ['--auto'] })
  assert.equal(await within(auto.exited, 3000), 0, 'an auto-start leaves at once')
  assert.ok(fs.existsSync(path.join(home, '.undertone', 'stopped')))

  const resumed = await bridge({ home, args: ['--auto', '--resume'] })
  assert.equal((await resumed.health()).ok, true)
  assert.ok(!fs.existsSync(path.join(home, '.undertone', 'stopped')), 'the marker is gone')
  assert.equal((await shutdown(resumed.port)).status, 202)
  assert.equal(await within(resumed.exited, 3000), 0)
  assert.ok(!fs.existsSync(path.join(home, '.undertone', 'stopped')), 'a plain shutdown leaves no marker')
})

test('the launcher starts a bridge that outlives it and writes to bridge.log', async () => {
  const home = tmpHome()
  const port = await freePort()
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'bridge', 'launch.mjs'), String(port), '--auto'], { env: envFor(home, {}) })
    let t = ''
    p.stdout.on('data', (c) => { t += c })
    p.on('exit', (code) => resolve({ code, text: t }))
  })
  assert.equal(out.code, 0)
  const pid = JSON.parse(out.text).pid
  children.add({ kill: (sig) => process.kill(pid, sig) })
  let h = null
  for (let i = 0; i < 100 && !h; i++) {
    try { h = await fetch('http://127.0.0.1:' + port + '/health').then((r) => r.json()) } catch { await sleep(50) }
  }
  assert.equal(h && h.lifetime.auto, true)
  assert.match(fs.readFileSync(path.join(home, '.undertone', 'bridge.log'), 'utf8'), /launch \d+ --auto[\s\S]*undertone bridge on/)
  assert.equal((await shutdown(port)).status, 202)
  for (let i = 0; i < 60; i++) {
    try { process.kill(pid, 0) } catch { break }
    await sleep(50)
  }
  assert.throws(() => process.kill(pid, 0), 'the bridge left')
})
