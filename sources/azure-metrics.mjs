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
// ~/.config/undertone/sources.json, one entry per source:
//   { "ourplace": { "label": "ourPlace prod", "metrics": [
//       { "resource": "<resource id>", "metric": "Requests", "as": "pulse", "what": "chats" },
//       { "resource": "<resource id>", "metric": "Http5xx", "as": "errors", "failAt": 3 } ] } }
//
//   as: "pulse"   each minute's total plays as that many soft notes (eight at most per report)
//   as: "errors"  a minute at or over failAt holds the sour note until a minute under it
//
// Azure publishes a minute's numbers a minute or two late, so each minute is played once it's
// three minutes old: the lane trails real time by about three minutes.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const BRIDGE = 'http://127.0.0.1:' + (process.env.UNDERTONE_PORT || 4747)
const CONFIG = path.join(os.homedir(), '.config', 'undertone', 'sources.json')
const SETTLE_MS = 3 * 60_000

async function send(events) {
  try {
    await fetch(BRIDGE + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(events) })
  } catch {}
}

const laneOf = (name, cfg) => ({ lane: 'src-' + name, project: name, label: cfg.label || name, source: 'azure' })

function az(args) {
  return new Promise((resolve, reject) => {
    execFile('az', args, { timeout: 45_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('az returned something that is not JSON')) }
    })
  })
}

// Per-minute totals for one metric over the last few minutes: [{ t, total }]
async function minutes(m, now) {
  const start = new Date(now - 10 * 60_000).toISOString()
  const end = new Date(now).toISOString()
  const j = await az(['monitor', 'metrics', 'list', '--resource', m.resource, '--metric', m.metric, '--interval', 'PT1M',
    '--aggregation', m.aggregation || 'Total', '--start-time', start, '--end-time', end, '-o', 'json'])
  const key = (m.aggregation || 'Total').toLowerCase()
  const data = (((j.value || [])[0] || {}).timeseries || []).flatMap((ts) => ts.data || [])
  const by = new Map()
  for (const d of data) {
    const t = Date.parse(d.timeStamp)
    by.set(t, (by.get(t) || 0) + (Number(d[key]) || 0))
  }
  return [...by].map(([t, total]) => ({ t, total })).sort((a, b) => a.t - b.t)
}

async function runSource(name, cfg) {
  const lane = laneOf(name, cfg)
  const seen = new Map() // metric index -> newest minute played
  const failing = new Map()
  await send([{ type: 'session.start', ...lane }])
  setInterval(() => send([{ type: 'alive', ...lane }]), 60_000)

  const tick = async () => {
    const now = Date.now()
    const out = []
    for (const [i, m] of (cfg.metrics || []).entries()) {
      let rows
      try { rows = await minutes(m, now) } catch (err) { console.error(`undertone ${name}: ${m.metric}: ${err.message}`); continue }
      const ripe = rows.filter((r) => r.t <= now - SETTLE_MS && r.t > (seen.get(i) || now - SETTLE_MS - 2 * 60_000))
      if (!ripe.length) continue
      seen.set(i, ripe[ripe.length - 1].t)
      const total = Math.round(ripe.reduce((a, r) => a + r.total, 0))
      if (m.as === 'errors') {
        const bad = ripe.some((r) => r.total >= (m.failAt || 1))
        if (bad && !failing.get(i)) { failing.set(i, true); out.push({ type: 'fail', ...lane }) }
        if (!bad && failing.get(i)) { failing.set(i, false); out.push({ type: 'pass', ...lane }) }
      } else if (total > 0) {
        out.push({ type: 'pulse', ...lane, count: total, what: m.what || m.metric, kind: m.kind || 'chime' })
      }
    }
    if (out.length) await send(out)
  }
  await tick()
  setInterval(tick, (cfg.everySec || 60) * 1000)
}

// Plausible traffic for a site with a chatbot: a few chats a minute that drift up and down, and
// every so often a burst of errors that clears a little later. Ten-second "minutes", to hear it fast.
async function runMock(name) {
  const lane = laneOf(name, { label: name + ' (mock)' })
  await send([{ type: 'session.start', ...lane }])
  setInterval(() => send([{ type: 'alive', ...lane }]), 60_000)
  let rate = 2
  let errorsUntil = 0
  setInterval(() => {
    const now = Date.now()
    rate = Math.max(0.3, Math.min(6, rate + (Math.random() - 0.5) * 1.2))
    let chats = 0
    for (let i = 0; i < 10; i++) if (Math.random() < rate / 10) chats++
    const out = []
    if (chats) out.push({ type: 'pulse', ...lane, count: chats, what: 'chats', kind: 'chime' })
    if (!errorsUntil && Math.random() < 0.02) { errorsUntil = now + 40_000; out.push({ type: 'fail', ...lane }) }
    if (errorsUntil && now > errorsUntil) { errorsUntil = 0; out.push({ type: 'pass', ...lane }) }
    if (out.length) send(out)
  }, 10_000)
  console.log('undertone: mock traffic for ' + name + ' (ctrl-c to stop)')
}

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
  for (const [name, cfg] of Object.entries(config)) runSource(name, cfg)
}
