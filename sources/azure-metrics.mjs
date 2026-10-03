// undertone source: Azure Monitor metrics, played as a lane of its own.
//
// Read-only and content-free by construction: it asks Azure Monitor for counts per minute
// (requests, model calls, errors) and nothing else. It never reads logs, traces or requests,
// so nothing a user typed can come through, which is what makes it safe for a HIPAA site.
// Needs the Azure CLI, logged in (`az login`).
//
//   node sources/azure-metrics.mjs               every source in ~/.config/undertone/sources.json
//   node sources/azure-metrics.mjs --mock NAME   made-up traffic for NAME, to hear it before it's wired
//
// The bridge starts this itself when sources.json exists (bridge/sources.mjs), so you rarely run it
// by hand. Only one copy runs at a time: it holds ~/.undertone/sources.pid while it does.
//
// ~/.config/undertone/sources.json, one entry per source:
//   { "ourplace": { "label": "ourPlace prod", "metrics": [
//       { "resource": "<resource id>", "metric": "Requests", "as": "pulse", "what": "chats" },
//       { "resource": "<resource id>", "metric": "Http5xx", "as": "errors", "failAt": 3 } ] } }
//
//   as: "pulse"   each minute's total plays as that many soft notes (eight at most per report)
//   as: "errors"  a minute at or over failAt holds the sour note (check "prod-errors:<metric>")
//                 until a minute under it
//
// Azure publishes a minute's numbers a minute or two late, so each minute is played once it's
// three minutes old: the lane trails real time by about three minutes. Every event carries
// origin "azure", which makes the lane an outside source: it never leads, calls you or pings you.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BRIDGE = 'http://127.0.0.1:' + (process.env.UNDERTONE_PORT || 4747)
const CONFIG = process.env.UNDERTONE_SOURCES_CONFIG || path.join(os.homedir(), '.config', 'undertone', 'sources.json')
const LOCK = path.join(process.env.UNDERTONE_HOME || path.join(os.homedir(), '.undertone'), 'sources.pid')
const SETTLE_MS = 3 * 60_000

async function postToBridge(events) {
  try {
    await fetch(BRIDGE + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(events) })
  } catch {}
}

export const laneOf = (name, cfg) => ({ lane: 'src-' + name, project: name, label: cfg.label || name, origin: 'azure' })

// How to run `az` here. On Windows it's az.cmd, which Node can only start through cmd.exe, and
// cmd.exe reads its line unquoted: so every argument must be plain (resource ids, metric names,
// ISO times), never a space, quote, &, | or anything else cmd.exe would act on.
const PLAIN = /^[A-Za-z0-9/_.:+,=-]+$/
export function azInvocation(args, platform = process.platform) {
  const bad = args.find((a) => !PLAIN.test(String(a)))
  if (bad !== undefined) throw new Error('refusing to pass ' + JSON.stringify(String(bad).slice(0, 40)) + ' to az: only letters, digits and / _ . : + , = -')
  return platform === 'win32' ? { file: 'az.cmd', args, shell: true } : { file: 'az', args, shell: false }
}

function runAz(args) {
  return new Promise((resolve, reject) => {
    let run
    try { run = azInvocation(args) } catch (err) { return reject(err) }
    execFile(run.file, run.args, { timeout: 45_000, maxBuffer: 8 * 1024 * 1024, shell: run.shell, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('az returned something that is not JSON')) }
    })
  })
}

// Per-minute totals for one metric over the last ten minutes: [{ t, total }]
async function minutes(az, m, now) {
  const j = await az(['monitor', 'metrics', 'list', '--resource', m.resource, '--metric', m.metric, '--interval', 'PT1M',
    '--aggregation', m.aggregation || 'Total', '--start-time', new Date(now - 10 * 60_000).toISOString(), '--end-time', new Date(now).toISOString(), '-o', 'json'])
  const key = (m.aggregation || 'Total').toLowerCase()
  const by = new Map()
  for (const d of (((j.value || [])[0] || {}).timeseries || []).flatMap((ts) => ts.data || [])) {
    const t = Date.parse(d.timeStamp)
    by.set(t, (by.get(t) || 0) + (Number(d[key]) || 0))
  }
  return [...by].map(([t, total]) => ({ t, total })).sort((a, b) => a.t - b.t)
}

// The events one metric's newly settled minutes make. Pure: `memo` carries what was already played
// and whether the errors are on, so a minute plays once and a failure clears exactly once.
export function eventsFor(lane, m, rows, memo, now) {
  const ripe = rows.filter((r) => r.t <= now - SETTLE_MS && r.t > (memo.seen ?? now - SETTLE_MS - 2 * 60_000))
  if (!ripe.length) return []
  memo.seen = ripe[ripe.length - 1].t
  if (m.as === 'errors') {
    const check = 'prod-errors:' + String(m.metric).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24)
    const bad = ripe.some((r) => r.total >= (m.failAt || 1))
    if (bad && !memo.failing) { memo.failing = true; return [{ type: 'fail', ...lane, check }] }
    if (!bad && memo.failing) { memo.failing = false; return [{ type: 'pass', ...lane, check }] }
    return []
  }
  const total = Math.round(ripe.reduce((a, r) => a + r.total, 0))
  return total > 0 ? [{ type: 'pulse', ...lane, count: total, what: m.what || m.metric, kind: m.kind || 'chime' }] : []
}

// Polls one source. Each tick waits for the previous one: `az` can take a while per metric, and two
// ticks at once would play the same minute twice.
export function makeSource(name, cfg, { az = runAz, send = postToBridge, clock = () => Date.now(), log = console.error } = {}) {
  const lane = laneOf(name, cfg)
  const memos = (cfg.metrics || []).map(() => ({}))
  let running = false
  const tick = async () => {
    if (running) return false
    running = true
    try {
      const now = clock()
      const out = []
      for (const [i, m] of (cfg.metrics || []).entries()) {
        try { out.push(...eventsFor(lane, m, await minutes(az, m, now), memos[i], now)) } catch (err) { log(`undertone ${name}: ${m.metric}: ${err.message}`) }
      }
      if (out.length) await send(out)
      return true
    } finally {
      running = false
    }
  }
  return { lane, tick }
}

async function runSource(name, cfg) {
  const src = makeSource(name, cfg)
  await postToBridge([{ type: 'session.start', ...src.lane }])
  setInterval(() => postToBridge([{ type: 'alive', ...src.lane }]), 60_000)
  const every = (cfg.everySec || 60) * 1000
  const loop = async () => { await src.tick(); setTimeout(loop, every) }
  loop()
}

// Plausible traffic for a site with a chatbot: a few chats a minute that drift up and down, and
// every so often a burst of errors that clears a little later. Ten-second "minutes", to hear it fast.
// Under its own name (`<name>-mock`), so made-up traffic never mixes with the real lane's numbers
async function runMock(name) {
  const lane = laneOf(name + '-mock', { label: name + ' (mock)' })
  const check = 'prod-errors:Http5xx'
  await postToBridge([{ type: 'session.start', ...lane }])
  setInterval(() => postToBridge([{ type: 'alive', ...lane }]), 60_000)
  let rate = 2
  let errorsUntil = 0
  setInterval(() => {
    const now = Date.now()
    rate = Math.max(0.3, Math.min(6, rate + (Math.random() - 0.5) * 1.2))
    let chats = 0
    for (let i = 0; i < 10; i++) if (Math.random() < rate / 10) chats++
    const out = []
    if (chats) out.push({ type: 'pulse', ...lane, count: chats, what: 'chats', kind: 'chime' })
    if (!errorsUntil && Math.random() < 0.02) { errorsUntil = now + 40_000; out.push({ type: 'fail', ...lane, check }) }
    if (errorsUntil && now > errorsUntil) { errorsUntil = 0; out.push({ type: 'pass', ...lane, check }) }
    if (out.length) postToBridge(out)
  }, 10_000)
  const bye = () => postToBridge([{ type: 'session.end', ...lane }]).then(() => process.exit(0))
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
  console.log('undertone: mock traffic for ' + name + ' (ctrl-c to stop)')
}

// One copy at a time: the pid of a live holder, or null once this process holds the lock (and lets
// it go on exit). The holder touches the lock every minute; one left by a process that's gone, or
// untouched for three minutes, is taken over. (Windows kills the bridge's child outright when the
// bridge dies, so no exit handler runs, and pids come back around: the touch is what tells.)
const LOCK_STALE_MS = 3 * 60_000
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8').trim())
    const fresh = Date.now() - fs.statSync(LOCK).mtimeMs < LOCK_STALE_MS
    if (pid && pid !== process.pid && fresh) {
      try { process.kill(pid, 0); return pid } catch (err) { if (err.code === 'EPERM') return pid }
    }
  } catch {}
  fs.mkdirSync(path.dirname(LOCK), { recursive: true })
  fs.writeFileSync(LOCK, String(process.pid))
  setInterval(() => { try { const t = new Date(); fs.utimesSync(LOCK, t, t) } catch {} }, 60_000).unref()
  process.on('exit', () => {
    try { if (Number(fs.readFileSync(LOCK, 'utf8').trim()) === process.pid) fs.unlinkSync(LOCK) } catch {}
  })
  return null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const mock = process.argv.indexOf('--mock')
  if (mock >= 0) {
    runMock(process.argv[mock + 1] || 'ourplace')
  } else {
    let config
    try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { config = null }
    if (!config || !Object.keys(config).length) {
      console.error('undertone: no sources yet. Describe them in ' + CONFIG + ' (see the top of this file), or try --mock ourplace')
      process.exit(1)
    }
    const holder = takeLock()
    if (holder) {
      console.log('undertone: sources already running (pid ' + holder + '); leaving them to it')
      process.exit(0)
    }
    // Started by the bridge: go when it goes (its end of the stdin pipe closes, however it died)
    if (process.env.UNDERTONE_SOURCES_CHILD === '1') {
      process.stdin.on('end', () => process.exit(0))
      process.stdin.on('close', () => process.exit(0))
      process.stdin.resume()
    }
    process.on('SIGINT', () => process.exit(0))
    process.on('SIGTERM', () => process.exit(0))
    for (const [name, cfg] of Object.entries(config)) runSource(name, cfg)
  }
}
