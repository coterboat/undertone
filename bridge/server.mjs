// undertone bridge: serves the music page and relays session events to it.
//   GET  /                the page (web/index.html, read fresh on each request)
//   GET  /engines/*.js    the page's sound engines
//   GET  /events          server-sent events: a hello with the known lanes, then every event
//   POST /event           one event or an array of them, as JSON (the mod posts here)
//   GET  /health          { ok, name, lanes, listeners }
//   POST /sc/start        start SuperCollider (sclang running sc/undertone.scd) if it isn't running
//   POST /sc              notes for SuperCollider, as JSON; relayed to sclang over OSC
// Listens on 127.0.0.1 only. No dependencies: `node bridge/server.mjs [port]`.

import http from 'node:http'
import dgram from 'node:dgram'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2] || process.env.UNDERTONE_PORT || 4747)
const HOST = '127.0.0.1'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = path.join(ROOT, 'web', 'index.html')
const ENGINES = path.join(ROOT, 'web', 'engines')
const MAX_BODY = 64 * 1024
// A session sends a heartbeat every minute; one silent for three is gone
const LANE_TTL_MS = 3 * 60 * 1000

const TYPES = new Set([
  'session.start', 'session.end', 'alive', 'prompt', 'turn.start', 'turn.end', 'attention', 'tool', 'edit',
  'commit', 'push', 'fail', 'pass', 'checklist', 'waiting', 'waiting.open', 'waiting.resolve',
])
const KINDS = new Set(['read', 'edit', 'run', 'web', 'agent', 'other'])
const REASONS = new Set(['permission', 'idle'])

const listeners = new Set()
const lanes = new Map() // lane id -> { lane, project, label, last }
let waitingBy = {} // project -> open questions, from the newest waiting snapshot

const clip = (v, n = 80) => String(v ?? '').slice(0, n)

// Keep only the fields the page reads, so nothing else a client posts gets relayed
function clean(e) {
  if (!e || typeof e !== 'object' || !TYPES.has(e.type)) return null
  const out = { type: e.type, lane: clip(e.lane || 'session', 64), project: clip(e.project, 64), label: clip(e.label || e.project, 64), ts: Date.now() }
  if (e.tool) out.tool = clip(e.tool, 64)
  if (KINDS.has(e.kind)) out.kind = e.kind
  if (REASONS.has(e.reason)) out.reason = e.reason
  if (e.source) out.source = clip(e.source, 32)
  for (const k of ['done', 'total', 'count']) if (Number.isFinite(e[k])) out[k] = Math.max(0, Math.min(999, Math.round(e[k])))
  if (e.type === 'waiting' && e.projects && typeof e.projects === 'object') {
    out.projects = {}
    for (const [p, n] of Object.entries(e.projects).slice(0, 40)) if (Number.isFinite(n)) out.projects[clip(p, 64)] = Math.max(0, Math.min(999, Math.round(n)))
  }
  return out
}

function track(e) {
  if (e.type === 'waiting') {
    if (e.projects) waitingBy = e.projects
    return
  }
  if (e.type === 'session.end') lanes.delete(e.lane)
  else lanes.set(e.lane, { lane: e.lane, project: e.project, label: e.label, last: Date.now() })
}

function broadcast(e) {
  const line = 'data: ' + JSON.stringify(e) + '\n\n'
  for (const res of listeners) res.write(line)
}

// Sessions that stopped sending (closed without a goodbye, or crashed) leave the page
setInterval(() => {
  const cutoff = Date.now() - LANE_TTL_MS
  for (const [id, l] of lanes) {
    if (l.last >= cutoff) continue
    lanes.delete(id)
    broadcast({ type: 'session.end', lane: id, project: l.project, label: l.label, stale: true, ts: Date.now() })
  }
}, 30_000).unref()

function page() {
  const body = fs.readFileSync(PAGE, 'utf8')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' +
    body + '</body></html>'
}

function readJson(req, res, then) {
  // A JSON content type keeps web pages from posting here without a CORS preflight, which we never answer
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    res.writeHead(415).end()
    return
  }
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > MAX_BODY) { res.writeHead(413).end(); req.destroy() } else chunks.push(c)
  })
  req.on('end', () => {
    if (res.writableEnded) return
    let parsed
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
    then(parsed)
  })
}

// ---------------------------------------------------------------- SuperCollider over OSC

const SC_LANG_PORT = 57130 // where sclang listens (not the IDE's 57120)
const SC_REPLY_PORT = 57131 // where sclang answers us
const SC_SCRIPT = path.join(ROOT, 'sc', 'undertone.scd')
const SCLANG = process.env.UNDERTONE_SCLANG || [
  '/Applications/SuperCollider.app/Contents/MacOS/sclang',
  '/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang',
  '/usr/bin/sclang', '/usr/local/bin/sclang',
].find((p) => fs.existsSync(p))

const sc = { proc: null, ready: false, waiters: [], log: [], meter: { peak: 0, rmsSum: 0, n: 0 } }
const udp = dgram.createSocket('udp4')

function oscPad(buf) {
  const pad = 4 - (buf.length % 4)
  return Buffer.concat([buf, Buffer.alloc(pad)])
}
const oscString = (s) => oscPad(Buffer.from(String(s), 'utf8'))

function oscMessage(address, args) {
  let tags = ','
  const parts = []
  for (const a of args) {
    if (typeof a === 'string') { tags += 's'; parts.push(oscString(a)) }
    else { tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(Number(a) || 0); parts.push(b) }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts])
}

function oscAddress(buf) {
  const end = buf.indexOf(0)
  return buf.toString('utf8', 0, end < 0 ? buf.length : end)
}

// The floats of an OSC message whose arguments are all floats
function oscFloats(buf) {
  let i = buf.indexOf(0)
  i += 4 - (i % 4)
  const tagEnd = buf.indexOf(0, i)
  const n = Math.max(0, tagEnd - i - 1)
  i = tagEnd + (4 - (tagEnd % 4))
  const out = []
  for (let k = 0; k < n && i + 4 <= buf.length; k++, i += 4) out.push(buf.readFloatBE(i))
  return out
}

udp.on('message', (msg) => {
  const address = oscAddress(msg)
  if (address === '/ut/peak') {
    const [pl, rl, pr, rr] = oscFloats(msg)
    sc.meter.peak = Math.max(sc.meter.peak, pl || 0, pr || 0)
    sc.meter.rmsSum += Math.max(rl || 0, rr || 0)
    sc.meter.n += 1
    return
  }
  if (address === '/ut/ready' || address === '/ut/pong') {
    sc.ready = true
    for (const w of sc.waiters.splice(0)) w(true)
  }
})
udp.on('error', (err) => console.error('undertone: OSC socket: ' + err.message))
udp.bind(SC_REPLY_PORT, HOST)

const num = (v, lo, hi, dflt = 0) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt)
const word = (v, allowed) => (allowed.includes(v) ? v : allowed[0])

// A page intent -> the OSC message sclang's /ut/* handlers read (sc/undertone.scd)
function toOsc(i) {
  const d = num(i.d, 0, 2, 0.05)
  switch (i.k) {
    case 'pad': return ['/ut/pad', [d, num(i.v, 0, 1), num(i.dur, 0, 20, 4), i.home ? 1 : 0, ...(Array.isArray(i.notes) ? i.notes.slice(0, 8).map((m) => num(m, 0, 127, 60)) : [])]]
    case 'bass': return ['/ut/bass', [d, num(i.m, 0, 127, 36), num(i.dur, 0, 8, 0.5), num(i.v, 0, 1)]]
    case 'voice': return ['/ut/voice', [d, word(i.t, ['keys', 'pluck', 'mallet', 'cello']), num(i.m, 0, 127, 60), num(i.dur, 0, 8, 0.3), num(i.v, 0, 1)]]
    case 'drum': return ['/ut/drum', [d, word(i.t, ['kick', 'snare', 'hat', 'tom', 'rim']), num(i.v, 0, 1), num(i.m, 0, 127, 0)]]
    case 'bell': return ['/ut/bell', [d, num(i.m, 0, 127, 72), num(i.dur, 0, 8, 1), num(i.v, 0, 1)]]
    case 'sour': return ['/ut/sour', [d, word(i.s, ['on', 'move', 'off']), num(i.m, 0, 127, 66), num(i.to, 0, 127, 67)]]
    case 'drone': return ['/ut/drone', [num(i.level, 0, 1), num(i.tonic, 0, 127, 50)]]
    case 'texture': return ['/ut/texture', [num(i.a, 0, 1)]]
    case 'energy': return ['/ut/energy', [d, num(i.e, 0, 1), num(i.base, 100, 5000, 900)]]
    case 'level': return ['/ut/level', [num(i.a, 0, 2)]]
    default: return null
  }
}

function sendToSc(intents) {
  for (const i of intents) {
    const m = i && typeof i === 'object' ? toOsc(i) : null
    if (m) udp.send(oscMessage(m[0], m[1]), SC_LANG_PORT, HOST)
  }
}

function waitForSc(ms) {
  if (sc.ready) return Promise.resolve(true)
  return new Promise((resolve) => {
    sc.waiters.push(resolve)
    setTimeout(() => resolve(false), ms)
  })
}

// On a Mac, scsynth touches the default input device even with no inputs, and macOS then asks
// for microphone access on behalf of whatever started it. Booting on an output-only device for
// both directions keeps the microphone out of it: [output device, input device] by name.
function macAudioDevices() {
  if (process.platform !== 'darwin') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile('system_profiler', ['SPAudioDataType', '-json'], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve([])
      try {
        const items = JSON.parse(stdout).SPAudioDataType[0]._items || []
        const out = items.find((d) => d.coreaudio_default_audio_output_device === 'spaudio_yes') || items.find((d) => d.coreaudio_device_output)
        if (!out) return resolve([])
        const quiet = out.coreaudio_device_input ? items.find((d) => d.coreaudio_device_output && !d.coreaudio_device_input) : out
        resolve([out._name, (quiet || out)._name])
      } catch {
        resolve([])
      }
    })
  })
}

async function startSc() {
  if (!SCLANG) return { ok: false, error: 'SuperCollider is not installed. On a Mac: brew install --cask supercollider' }
  // Already running (ours, or one left from before): it answers a ping
  sc.ready = false
  udp.send(oscMessage('/ut/ping', []), SC_LANG_PORT, HOST)
  if (await waitForSc(400)) return { ok: true }
  if (!sc.proc) {
    sc.log = []
    const devices = await macAudioDevices()
    sc.proc = spawn(SCLANG, ['-D', '-u', String(SC_LANG_PORT), SC_SCRIPT, ...devices], { stdio: ['ignore', 'pipe', 'pipe'] })
    const keep = (d) => { sc.log.push(String(d)); if (sc.log.length > 80) sc.log.shift() }
    sc.proc.stdout.on('data', keep)
    sc.proc.stderr.on('data', keep)
    sc.proc.on('exit', (code) => { sc.proc = null; sc.ready = false; console.log('undertone: sclang exited (' + code + ')') })
  }
  if (await waitForSc(30_000)) return { ok: true }
  return { ok: false, error: 'SuperCollider did not answer in 30 seconds. Its last output: ' + sc.log.join('').slice(-600) }
}

// Ask sclang to stop its server and quit; kill it if it hasn't after a moment
function stopSc() {
  const proc = sc.proc
  if (!proc) return Promise.resolve()
  udp.send(oscMessage('/ut/quit', []), SC_LANG_PORT, HOST)
  return new Promise((resolve) => {
    const t = setTimeout(() => { proc.kill(); resolve() }, 1500)
    proc.once('exit', () => { clearTimeout(t); resolve() })
  })
}
const shutdown = () => stopSc().then(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', () => { if (sc.proc) sc.proc.kill() })

// ---------------------------------------------------------------- HTTP

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + HOST)

  if (req.method === 'GET' && url.pathname === '/') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(page())
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('undertone: could not read the page at ' + PAGE + ': ' + err.message)
    }
    return
  }

  const engine = /^\/engines\/([a-z0-9-]+\.js)$/.exec(url.pathname)
  if (req.method === 'GET' && engine) {
    const file = path.join(ENGINES, engine[1])
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end(fs.readFileSync(file))
    return
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    res.write('data: ' + JSON.stringify({ type: 'hello', lanes: [...lanes.values()], waitingBy }) + '\n\n')
    listeners.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 20000)
    req.on('close', () => { clearInterval(ping); listeners.delete(res) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/event') {
    readJson(req, res, (parsed) => {
      const events = (Array.isArray(parsed) ? parsed : [parsed]).map(clean).filter(Boolean)
      for (const e of events) { track(e); broadcast(e) }
      res.writeHead(204).end()
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/sc') {
    readJson(req, res, (parsed) => {
      sendToSc(Array.isArray(parsed) ? parsed.slice(0, 200) : [parsed])
      res.writeHead(204).end()
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/sc/start') {
    startSc().then((r) => {
      res.writeHead(r.ok ? 200 : 503, { 'content-type': 'application/json' })
      res.end(JSON.stringify(r))
    })
    return
  }

  // SuperCollider's recent output, and its loudness since the last read (in dBFS)
  if (req.method === 'GET' && url.pathname === '/sc/log') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(sc.log.join(''))
    return
  }
  if (req.method === 'GET' && url.pathname === '/sc/meter') {
    const db = (a) => (a > 0 ? Math.round(20 * Math.log10(a) * 10) / 10 : -Infinity)
    const m = sc.meter
    sc.meter = { peak: 0, rmsSum: 0, n: 0 }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ peakDb: db(m.peak), avgRmsDb: db(m.n ? m.rmsSum / m.n : 0), samples: m.n }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, name: 'undertone', lanes: lanes.size, listeners: listeners.size, waitingBy, sc: { installed: !!SCLANG, running: !!sc.proc, ready: sc.ready } }))
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
})

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  // Another bridge already has the port: fine if it's ours, an error if it's something else
  try {
    const r = await fetch('http://' + HOST + ':' + PORT + '/health')
    const j = await r.json()
    if (j.name === 'undertone') {
      console.log('undertone bridge already running on http://' + HOST + ':' + PORT)
      process.exit(0)
    }
  } catch {}
  console.error('undertone: port ' + PORT + ' is taken by something else. Pass another port: node bridge/server.mjs 4848')
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log('undertone bridge on http://' + HOST + ':' + PORT)
})
