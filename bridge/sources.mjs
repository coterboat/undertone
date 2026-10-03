// The bridge runs your outside sources (sources/azure-metrics.mjs) itself, so `npm start` is the
// only window: they start when ~/.config/undertone/sources.json describes at least one source,
// restart when that file changes, start again (backing off) when they die, and stop with the
// bridge. UNDERTONE_SOURCES=0 turns this off; `npm run sources` still runs them by hand.
//
// The child gets a pipe on stdin and quits when it closes, so it goes when the bridge goes, even
// when the bridge is killed outright (on Windows, Node kills it along with the bridge anyway). A
// source already running elsewhere holds a lock (~/.undertone/sources.pid) and the child steps
// aside until it's gone.

import fs from 'node:fs'
import { spawn } from 'node:child_process'

export function describesSources(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return !!j && typeof j === 'object' && !Array.isArray(j) && Object.keys(j).length > 0
  } catch {
    return false
  }
}

export function superviseSources({
  script, config, port, env = process.env, log = console.log,
  watchMs = 5000, againMs = 5000, quickMs = 15_000, maxMs = 600_000, steadyMs = 60_000,
}) {
  const st = { proc: null, startedAt: 0, restarts: 0, last: '', timer: null, backoff: quickMs, stopped: false }

  const start = () => {
    clearTimeout(st.timer)
    st.timer = null
    if (st.stopped || st.proc || !describesSources(config)) return
    const proc = spawn(process.execPath, [script], {
      env: { ...env, UNDERTONE_PORT: String(port), UNDERTONE_SOURCES_CONFIG: config, UNDERTONE_SOURCES_CHILD: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    st.proc = proc
    st.startedAt = Date.now()
    const lines = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((line) => { st.last = line.slice(0, 300); log('sources: ' + line) })
    proc.stdout.on('data', lines)
    proc.stderr.on('data', lines)
    proc.stdin.on('error', () => {})
    proc.on('error', (err) => { st.last = err.message })
    proc.on('exit', (code) => {
      if (st.proc !== proc) return
      st.proc = null
      if (st.stopped || !describesSources(config)) return
      // A run that lasted is restarted soon; one that dies at once waits longer each time
      const ran = Date.now() - st.startedAt
      st.backoff = ran >= steadyMs ? quickMs : Math.min(st.backoff * 2, maxMs)
      const wait = ran >= steadyMs ? againMs : st.backoff
      if (code) log('sources: stopped (exit ' + code + '); starting again in ' + Math.round(wait / 1000) + 's')
      st.restarts++
      st.timer = setTimeout(start, wait)
    })
  }

  const halt = () => new Promise((resolve) => {
    const proc = st.proc
    if (!proc) return resolve()
    st.proc = null
    const t = setTimeout(() => { proc.kill(); resolve() }, 1500)
    proc.once('exit', () => { clearTimeout(t); resolve() })
    proc.stdin.end()
  })

  // A changed file restarts them (a new source, a new metric); an emptied or deleted one stops them
  const onChange = (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return
    st.backoff = quickMs
    halt().then(() => { if (describesSources(config)) { if (prev.mtimeMs) st.restarts++; start() } })
  }
  fs.watchFile(config, { interval: watchMs }, onChange)
  start()

  return {
    status: () => ({ configured: describesSources(config), running: !!st.proc, pid: st.proc?.pid ?? null, restarts: st.restarts, last: st.last }),
    stop: () => { st.stopped = true; clearTimeout(st.timer); fs.unwatchFile(config, onChange); return halt() },
    kill: () => { st.stopped = true; if (st.proc) st.proc.kill() },
  }
}
