// undertone bridge: serves the music page and relays session events to it.
//   GET  /                the page (web/index.html, read fresh on each request)
//   GET  /engines/*.js    the page's sound engines
//   GET  /events          server-sent events: a hello with the known lanes, then every event
//   POST /event           one event or an array of them, as JSON (the mod posts here)
//   GET  /health          { ok, name, lanes, listeners }
//   POST /sc/start        start SuperCollider (sclang running sc/undertone.scd) if it isn't running
//   POST /sc              notes for SuperCollider, as JSON; relayed to sclang over OSC
//   POST /ear             a reaction or snapshot from the page: the last 20-30 s of audio and what
//                         was playing; saved with its analysis under ~/.undertone/ear (see ear/)
//   POST /notify/test     send a test ping to your phone (ntfy; see ~/.config/undertone/ntfy.json)
// Every event is also appended to ~/.undertone/log/<date>.jsonl, the raw material for metrics.
// A session that waits on you (a permission prompt for a minute, idle for five) pings your phone.
// Listens on 127.0.0.1 only. No dependencies: `node bridge/server.mjs [port]`.

import http from 'node:http'
import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeClip, parseWav, writeWav } from '../ear/analyze.mjs'
import { critique, geminiKey } from '../ear/gemini.mjs'

const PORT = Number(process.argv[2] || process.env.UNDERTONE_PORT || 4747)
const HOST = '127.0.0.1'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = path.join(ROOT, 'web', 'index.html')
const ENGINES = path.join(ROOT, 'web', 'engines')
const MAX_BODY = 64 * 1024
const MAX_EAR_BODY = 16 * 1024 * 1024
const HOME = process.env.UNDERTONE_HOME || path.join(os.homedir(), '.undertone')
const LOG_DIR = path.join(HOME, 'log')
const EAR_DIR = path.join(HOME, 'ear')
fs.mkdirSync(LOG_DIR, { recursive: true })
fs.mkdirSync(EAR_DIR, { recursive: true })
// A session sends a heartbeat every minute; one silent for three is gone
const LANE_TTL_MS = 3 * 60 * 1000

const TYPES = new Set([
  'session.start', 'session.end', 'alive', 'prompt', 'turn.start', 'turn.end', 'attention', 'tool', 'edit',
  'commit', 'push', 'fail', 'pass', 'checklist', 'waiting', 'waiting.open', 'waiting.resolve',
  'pulse', // an outside source: `count` things happened (chats on a site, fills in a bot), played as notes
])
const KINDS = new Set(['read', 'edit', 'run', 'web', 'agent', 'other', 'chime'])
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
  if (e.what) out.what = clip(e.what, 40)
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

const day = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

// The last few minutes stay in memory (what was going on when you reacted); everything goes to the day's log
const recent = []
function logEvent(e) {
  recent.push(e)
  if (recent.length > 3000) recent.splice(0, recent.length - 3000)
  fs.appendFile(path.join(LOG_DIR, day(new Date(e.ts)) + '.jsonl'), JSON.stringify(e) + '\n', () => {})
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

function readJson(req, res, then, max = MAX_BODY) {
  // A JSON content type keeps web pages from posting here without a CORS preflight, which we never answer
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    res.writeHead(415).end()
    return
  }
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > max) { res.writeHead(413).end(); req.destroy() } else chunks.push(c)
  })
  req.on('end', () => {
    if (res.writableEnded) return
    let parsed
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
    then(parsed)
  })
}

// ---------------------------------------------------------------- your phone (ntfy)

const NTFY_FILE = path.join(os.homedir(), '.config', 'undertone', 'ntfy.json')
function ntfyConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(NTFY_FILE, 'utf8'))
    return c && c.topic ? { server: 'https://ntfy.sh', permissionAfterSec: 60, idleAfterSec: 300, ...c } : null
  } catch {
    return null
  }
}

// JSON publishing, so titles with any characters go through
function notifyPhone(title, message, priority = 3, tags = ['musical_note']) {
  const c = ntfyConfig()
  if (!c) return Promise.resolve(false)
  return fetch(c.server.replace(/\/+$/, '') + '/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: c.topic, title, message, priority, tags }),
  }).then((r) => r.ok).catch(() => false)
}

// A call nobody answered at the desk goes to the phone; anything else the session does cancels it
const phoneTimers = new Map() // lane -> timer
function watchForPhone(e) {
  if (e.type === 'alive' || e.type === 'waiting') return
  if (phoneTimers.has(e.lane)) { clearTimeout(phoneTimers.get(e.lane)); phoneTimers.delete(e.lane) }
  if (e.type !== 'attention') return
  const c = ntfyConfig()
  if (!c) return
  const idle = e.reason === 'idle'
  phoneTimers.set(e.lane, setTimeout(() => {
    phoneTimers.delete(e.lane)
    notifyPhone(
      e.label + (idle ? ' is waiting for you' : ' needs your OK'),
      idle ? 'Claude finished and has been sitting idle.' : 'A permission prompt has been waiting for a minute.',
      idle ? 3 : 4,
      [idle ? 'hourglass' : 'raised_hand'],
    )
  }, (idle ? c.idleAfterSec : c.permissionAfterSec) * 1000))
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

const sc = { proc: null, ready: false, waiters: [], log: [], meter: { peak: 0, rmsSum: 0, n: 0 }, dumps: new Map() }
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

// An OSC message's arguments: ints, floats, doubles and strings
function oscArgs(buf) {
  let i = buf.indexOf(0)
  i += 4 - (i % 4)
  const tagEnd = buf.indexOf(0, i)
  const tags = buf.toString('ascii', i + 1, tagEnd)
  i = tagEnd + (4 - (tagEnd % 4))
  const out = []
  for (const t of tags) {
    if (t === 'f') { out.push(buf.readFloatBE(i)); i += 4 }
    else if (t === 'i') { out.push(buf.readInt32BE(i)); i += 4 }
    else if (t === 'd') { out.push(buf.readDoubleBE(i)); i += 8 }
    else if (t === 's') { const e = buf.indexOf(0, i); out.push(buf.toString('utf8', i, e)); i = e + (4 - (e % 4)) }
    else break
  }
  return out
}

udp.on('message', (msg) => {
  const address = oscAddress(msg)
  if (address === '/ut/dumped') {
    const args = oscArgs(msg)
    const done = sc.dumps.get(args[0])
    if (done) { sc.dumps.delete(args[0]); done(args) }
    return
  }
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

// SuperCollider keeps the last 30 seconds of its output in a ring buffer; this has it written to a
// file and answers with where the ring's write head was, so the clip can be put back in order
function dumpSc(file) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { sc.dumps.delete(file); resolve(null) }, 8000)
    sc.dumps.set(file, (args) => { clearTimeout(t); resolve(args) })
    udp.send(oscMessage('/ut/dump', [file]), SC_LANG_PORT, HOST)
  })
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

// ---------------------------------------------------------------- ears

const KINDS_EAR = ['love', 'grates', 'snapshot']

// Saves a reaction or snapshot: the clip, a spectrogram, its numbers, what was playing and the
// events around it. Gemini critiques it in the background when a key is set.
async function saveEar(body) {
  const kind = KINDS_EAR.includes(body.kind) ? body.kind : 'snapshot'
  const state = body.state && typeof body.state === 'object' ? body.state : {}
  const engine = clip(state.engine || 'unknown', 20).replace(/[^a-z0-9-]/gi, '')
  const now = new Date()
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((v) => String(v).padStart(2, '0')).join('')
  const dir = path.join(EAR_DIR, day(now), time + '-' + engine + '-' + kind)
  fs.mkdirSync(dir, { recursive: true })

  let mono, sampleRate
  if (body.wav) {
    ({ mono, sampleRate } = parseWav(Buffer.from(String(body.wav), 'base64')))
  } else if (engine === 'sc') {
    if (!sc.ready) throw new Error('SuperCollider is not running')
    const ringFile = path.join(dir, 'sc-ring.wav')
    const reply = await dumpSc(ringFile)
    if (!reply) throw new Error('SuperCollider did not hand over its recording')
    const ring = parseWav(fs.readFileSync(ringFile))
    fs.unlinkSync(ringFile)
    const head = Math.max(0, Math.min(ring.mono.length, Math.round(reply[1])))
    const ordered = new Float32Array(ring.mono.length)
    ordered.set(ring.mono.subarray(head))
    ordered.set(ring.mono.subarray(0, head), ring.mono.length - head)
    const keep = Math.min(ordered.length, Math.round(ring.sampleRate * (kind === 'snapshot' ? 30 : 20)))
    mono = ordered.subarray(ordered.length - keep)
    sampleRate = ring.sampleRate
  } else {
    throw new Error('no audio came with the request')
  }

  const { stats, legend, png } = analyzeClip(mono, sampleRate)
  const since = now.getTime() - (stats.seconds + 30) * 1000
  fs.writeFileSync(path.join(dir, 'clip.wav'), writeWav(mono, sampleRate))
  fs.writeFileSync(path.join(dir, 'spectrogram.png'), png)
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(stats, null, 2))
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ kind, note: clip(body.note, 500), at: now.toISOString(), state, legend }, null, 2))
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(recent.filter((e) => e.ts >= since && e.type !== 'alive'), null, 1))
  fs.appendFileSync(path.join(EAR_DIR, 'index.jsonl'), JSON.stringify({
    at: now.toISOString(), dir, kind, engine, mood: state.mood, rmsDb: stats.rmsDb, clicksPerMinute: stats.clicksPerMinute, centroidHz: stats.centroidHz,
  }) + '\n')
  const gemini = !!geminiKey()
  if (gemini) critique(dir).catch((err) => fs.writeFileSync(path.join(dir, 'critique-error.txt'), String(err && err.message ? err.message : err)))
  return { dir, stats, gemini }
}

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
      for (const e of events) { track(e); logEvent(e); watchForPhone(e); broadcast(e) }
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

  if (req.method === 'POST' && url.pathname === '/ear') {
    readJson(req, res, (parsed) => {
      saveEar(parsed).then((r) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...r }))
      }).catch((err) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }))
      })
    }, MAX_EAR_BODY)
    return
  }

  if (req.method === 'POST' && url.pathname === '/notify/test') {
    notifyPhone('undertone is connected', 'When a session waits on you for a minute, it pings you here.', 3, ['musical_note']).then((ok) => {
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok, configured: !!ntfyConfig() }))
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
