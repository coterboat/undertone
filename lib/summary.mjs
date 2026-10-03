// A day of one machine's events, boiled down to what's worth keeping. Raw events stay in the local
// log; this is the part that travels (through the brain) and that timesheets read.
//
// summarizeDay(events, { date, device, now }) ->
//   { v, date, device,
//     projects: { <project>: { activeMin, laneMin, blockedMin, brokenMin: { <check>: min },
//                              sessions, turns, commits, pushes, first, last } },
//     sources:  { <source>: { totals: { <what>: count }, errorMin } } }
//
//   activeMin   minutes Claude was working in at least one of the project's sessions (wall clock)
//   laneMin     the same minutes summed over sessions: three parallel lanes for an hour is 180
//   blockedMin  minutes sessions sat on a permission prompt, each wait counted up to an hour
//               (past that you were away, and an all-night prompt would drown the rest)
//   brokenMin   minutes each check stayed failing in at least one of the project's sessions
//   first/last  local time of the first and last piece of work
//
// Pure: events and the clock come in. It walks the day minute by minute through the same reducer
// the bridge uses (lib/lanes.mjs).

import { emptyState, reduce, sweep, isExternal } from './lanes.mjs'

const WORK = new Set(['prompt', 'turn.start', 'tool', 'edit', 'commit', 'push'])
const MIN = 60_000
const BLOCK_CAP_MS = 60 * MIN
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

export function summarizeDay(events, { date, device, now = Infinity } = {}) {
  const evs = events.filter((e) => e && typeof e.type === 'string' && Number.isFinite(e.ts)).sort((a, b) => a.ts - b.ts)
  const out = { v: 1, date, device, projects: {}, sources: {} }
  if (!evs.length) return out

  const proj = (name) => (out.projects[name] = out.projects[name] || { activeMin: 0, laneMin: 0, blockedMin: 0, brokenMin: {}, sessions: 0, turns: 0, commits: 0, pushes: 0, first: null, last: null })
  const src = (name) => (out.sources[name] = out.sources[name] || { totals: {}, errorMin: 0 })

  // Counts straight from the events
  const started = new Set()
  for (const e of evs) {
    if (isExternal(e)) {
      if (e.type === 'pulse' && e.project) { const s = src(e.project); const k = e.what || 'events'; s.totals[k] = (s.totals[k] || 0) + (Number(e.count) || 0) }
      continue
    }
    if (!e.project) continue
    const p = proj(e.project)
    if (e.type === 'session.start' && !started.has(e.lane)) { started.add(e.lane); p.sessions += 1 }
    if (e.type === 'turn.start') p.turns += 1
    if (e.type === 'commit') p.commits += 1
    if (e.type === 'push') p.pushes += 1
    if (WORK.has(e.type)) { if (!p.first) p.first = hhmm(e.ts); p.last = hhmm(e.ts) }
  }

  // Minutes, by walking the day through the reducer
  const end = Math.min(now, evs[evs.length - 1].ts + 60 * MIN)
  let state = emptyState()
  let i = 0
  const seenWork = new Set() // a lane carried over from yesterday isn't "working" until it does something today
  for (let m = Math.floor(evs[0].ts / MIN) * MIN; m < end && (i < evs.length || Object.keys(state.lanes).length); m += MIN) {
    const workedNow = new Set()
    for (; i < evs.length && evs[i].ts < m + MIN; i++) {
      const e = evs[i]
      state = reduce(state, e, e.ts)
      if (WORK.has(e.type) && e.lane) { workedNow.add(e.lane); seenWork.add(e.lane) }
    }
    state = sweep(state, m + MIN).state
    const tally = {}
    for (const l of Object.values(state.lanes)) {
      if (l.external) {
        if (Object.keys(l.failing).length) src(l.project).errorMin += 1
        continue
      }
      const t = (tally[l.project] = tally[l.project] || { active: 0, blocked: 0, broken: new Set() })
      if (workedNow.has(l.lane) || (l.state === 'working' && seenWork.has(l.lane))) t.active += 1
      if (l.state === 'needs_ok' && m + MIN - (l.needsSince || m) <= BLOCK_CAP_MS) t.blocked += 1
      for (const c of Object.keys(l.failing)) t.broken.add(c)
    }
    for (const [name, t] of Object.entries(tally)) {
      if (!t.active && !t.blocked && !t.broken.size) continue
      const p = proj(name)
      if (t.active) { p.activeMin += 1; p.laneMin += t.active }
      p.blockedMin += t.blocked
      for (const c of t.broken) p.brokenMin[c] = (p.brokenMin[c] || 0) + 1
    }
  }

  // Projects with nothing to say are noise
  for (const [name, p] of Object.entries(out.projects)) {
    if (!p.activeMin && !p.blockedMin && !Object.keys(p.brokenMin).length && !p.turns && !p.commits) delete out.projects[name]
  }
  return out
}

// Several machines' summaries for the same days, added up per project
export function mergeSummaries(summaries) {
  const days = [...new Set(summaries.map((s) => s.date))].sort()
  const devices = [...new Set(summaries.map((s) => s.device))].sort()
  const projects = {}
  const sources = {}
  for (const s of summaries) {
    for (const [name, p] of Object.entries(s.projects || {})) {
      const q = (projects[name] = projects[name] || { perDay: {}, activeMin: 0, laneMin: 0, blockedMin: 0, brokenMin: {}, sessions: 0, turns: 0, commits: 0, pushes: 0 })
      q.perDay[s.date] = (q.perDay[s.date] || 0) + p.activeMin
      for (const k of ['activeMin', 'laneMin', 'blockedMin', 'sessions', 'turns', 'commits', 'pushes']) q[k] += p[k] || 0
      for (const [c, n] of Object.entries(p.brokenMin || {})) q.brokenMin[c] = (q.brokenMin[c] || 0) + n
    }
    for (const [name, x] of Object.entries(s.sources || {})) {
      const q = (sources[name] = sources[name] || { totals: {}, errorMin: 0 })
      for (const [k, n] of Object.entries(x.totals || {})) q.totals[k] = (q.totals[k] || 0) + n
      q.errorMin += x.errorMin || 0
    }
  }
  return { days, devices, projects, sources }
}
