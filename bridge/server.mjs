// undertone bridge: serves the music page and relays session events to it.
//   GET  /         the page (web/index.html, read fresh on each request)
//   GET  /events   server-sent events: a hello with the known lanes, then every event
//   POST /event    one event or an array of them, as JSON (the mod posts here)
//   GET  /health   { ok, name, lanes, listeners }
// Listens on 127.0.0.1 only. No dependencies: `node bridge/server.mjs [port]`.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2] || process.env.UNDERTONE_PORT || 4747)
const HOST = '127.0.0.1'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = path.join(ROOT, 'web', 'index.html')
const MAX_BODY = 64 * 1024
const LANE_TTL_MS = 30 * 60 * 1000

const TYPES = new Set([
  'session.start', 'session.end', 'prompt', 'turn.start', 'turn.end', 'tool', 'edit',
  'commit', 'push', 'fail', 'pass', 'checklist', 'waiting', 'waiting.open', 'waiting.resolve',
])
const KINDS = new Set(['read', 'edit', 'run', 'web', 'agent', 'other'])

const listeners = new Set()
const lanes = new Map() // lane id -> { lane, project, label, last }
let waiting = 0

const clip = (v, n = 80) => String(v ?? '').slice(0, n)

// Keep only the fields the page reads, so nothing else a client posts gets relayed
function clean(e) {
  if (!e || typeof e !== 'object' || !TYPES.has(e.type)) return null
  const out = { type: e.type, lane: clip(e.lane || 'session', 64), project: clip(e.project, 64), label: clip(e.label || e.project, 64), ts: Date.now() }
  if (e.tool) out.tool = clip(e.tool, 64)
  if (KINDS.has(e.kind)) out.kind = e.kind
  if (e.source) out.source = clip(e.source, 32)
  for (const k of ['done', 'total', 'count']) if (Number.isFinite(e[k])) out[k] = Math.max(0, Math.min(999, Math.round(e[k])))
  return out
}

function track(e) {
  if (e.type === 'session.end') lanes.delete(e.lane)
  else lanes.set(e.lane, { lane: e.lane, project: e.project, label: e.label, last: Date.now() })
  if (e.type === 'waiting') waiting = e.count ?? waiting
  if (e.type === 'waiting.open') waiting += 1
  if (e.type === 'waiting.resolve') waiting = Math.max(0, waiting - 1)
}

function liveLanes() {
  const cutoff = Date.now() - LANE_TTL_MS
  for (const [id, l] of lanes) if (l.last < cutoff) lanes.delete(id)
  return [...lanes.values()]
}

function broadcast(e) {
  const line = 'data: ' + JSON.stringify(e) + '\n\n'
  for (const res of listeners) res.write(line)
}

function page() {
  const body = fs.readFileSync(PAGE, 'utf8')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' +
    body + '</body></html>'
}

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

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    res.write('data: ' + JSON.stringify({ type: 'hello', lanes: liveLanes(), waiting }) + '\n\n')
    listeners.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 20000)
    req.on('close', () => { clearInterval(ping); listeners.delete(res) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/event') {
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
      const events = (Array.isArray(parsed) ? parsed : [parsed]).map(clean).filter(Boolean)
      for (const e of events) { track(e); broadcast(e) }
      res.writeHead(204).end()
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, name: 'undertone', lanes: liveLanes().length, listeners: listeners.size, waiting }))
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
