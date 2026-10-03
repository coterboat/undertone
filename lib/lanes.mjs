// undertone's picture of every session, shared by the bridge (which runs every event through it
// and serves the result at /state) and the page (which starts from that picture). Pure: no I/O,
// no clocks; `now` (milliseconds) is always passed in.
//
// A lane:
//   { lane, project, label, state, needsReason, needsSince, failing, checklist, scheduled,
//     external, known, openedAt, last, lastWork }
//   state        working | needs_ok | your_move | idle
//   needsReason  permission (a prompt is blocking it) | idle (Claude sat idle) | done (a turn ended)
//   failing      { <check>: since } — a lane is failing while this has any key; a pass clears its own
//   known        it has said session.start or alive (only known lanes may ping your phone)
//   external     an outside source (a production site, a bot): colours the music, never leads it,
//                never calls you, never pings your phone

export const LANE_TTL_MS = 3 * 60_000 // sessions send `alive` every minute; three silent minutes and a lane is gone
export const IDLE_MS = 15 * 60_000 // a working lane with no work this long is idle

export const isExternal = (e) => !!(e && (e.origin || String(e.lane || '').startsWith('src-')))

// Which check a fail/pass is about. Events from before 0.3 only had `source` (command | checks).
export function checkOf(e) {
  if (e && typeof e.check === 'string' && e.check) return e.check
  if (e && e.source === 'checks') return 'checks'
  return 'build'
}

const FAMILY = { test: 'tests', typecheck: 'typecheck', lint: 'lint', build: 'build', checks: 'checks', 'prod-errors': 'prod errors' }

// "test:vitest" -> "tests (vitest)", "prod-errors:Http5xx" -> "prod errors (Http5xx)"
export function checkLabel(check) {
  const [family, tool] = String(check || 'build').split(':')
  return (FAMILY[family] || family) + (tool ? ' (' + tool + ')' : '')
}

// Each kind of failure has its own sour note, so you can hear what broke: [semitones over the
// chord's root, lowest MIDI note, highest]. Tests are the tritone the build always had.
const SOUR = {
  test: [6, 66, 77],
  typecheck: [1, 70, 81], // a grinding minor second, up high
  lint: [11, 70, 81], // a softer major seventh
  build: [1, 54, 65], // the minor second, low
  checks: [6, 66, 77],
  'prod-errors': [6, 42, 53], // production: the tritone down in the rumble
}
export function sourFor(check, root) {
  const [interval, lo, hi] = SOUR[String(check || 'build').split(':')[0]] || SOUR.build
  let n = root + interval
  while (n < lo) n += 12
  while (n > hi) n -= 12
  return n
}

export function emptyState() {
  return { lanes: {}, waitingBy: {} }
}

const WORK = new Set(['session.start', 'prompt', 'turn.start', 'tool', 'edit', 'commit', 'push'])

function laneFor(state, e, now) {
  const prev = state.lanes[e.lane]
  if (prev) return { ...prev, failing: { ...prev.failing } }
  return {
    lane: e.lane, project: e.project || 'session', label: e.label || e.project || 'session',
    state: 'working', needsReason: null, needsSince: null, failing: {}, checklist: null,
    scheduled: false, external: isExternal(e), known: false, openedAt: now, last: now, lastWork: now,
  }
}

export function reduce(state, e, now) {
  if (!e || typeof e.type !== 'string') return state
  if (e.type === 'waiting') return e.projects && typeof e.projects === 'object' ? { ...state, waitingBy: { ...e.projects } } : state
  if (!e.lane) return state
  if (e.type === 'session.end') {
    const lanes = { ...state.lanes }
    delete lanes[e.lane]
    return { ...state, lanes }
  }

  const l = laneFor(state, e, now)
  l.last = now
  if (e.project) l.project = e.project
  if (e.label) l.label = e.label
  if (isExternal(e)) l.external = true
  if (e.scheduled) l.scheduled = true
  if (e.type === 'session.start' || e.type === 'alive') l.known = true

  const working = () => { l.state = 'working'; l.needsReason = null; l.needsSince = null; l.lastWork = now }
  if (WORK.has(e.type)) working()
  else if (e.type === 'pulse' && l.external) working()

  if (e.type === 'turn.end' && !l.external) {
    if (l.scheduled) { l.state = 'idle'; l.needsReason = null; l.needsSince = null }
    else { l.state = 'your_move'; l.needsReason = 'done'; l.needsSince = now }
  }
  if (e.type === 'attention' && !l.external) {
    if (e.reason === 'permission') {
      if (l.state !== 'needs_ok') l.needsSince = now
      l.state = 'needs_ok'
      l.needsReason = 'permission'
    } else if (!l.scheduled) {
      if (l.state !== 'your_move') l.needsSince = now
      l.state = 'your_move'
      l.needsReason = 'idle'
    }
  }
  if (e.type === 'fail') { const c = checkOf(e); if (!l.failing[c]) l.failing[c] = now }
  if (e.type === 'pass') delete l.failing[checkOf(e)]
  if (e.type === 'checklist') l.checklist = { done: Number(e.done) || 0, total: Number(e.total) || 0 }

  return { ...state, lanes: { ...state.lanes, [e.lane]: l } }
}

// Drops lanes that went silent and settles working lanes that stopped working. Lanes that wait on
// you stay waiting: that's still true however long it takes.
export function sweep(state, now, ttl = LANE_TTL_MS, idle = IDLE_MS) {
  const lanes = {}
  const removed = []
  for (const [id, l] of Object.entries(state.lanes)) {
    if (now - l.last > ttl) { removed.push(id); continue }
    lanes[id] = l.state === 'working' && now - l.lastWork > idle ? { ...l, state: 'idle' } : l
  }
  return { state: { ...state, lanes }, removed }
}

// What GET /state answers, and what the SSE hello carries
export function snapshot(state, now) {
  return {
    ok: true,
    at: now,
    lanes: Object.values(state.lanes).map((l) => ({ ...l, failing: { ...l.failing }, failingChecks: Object.keys(l.failing) })),
    waitingBy: { ...state.waitingBy },
  }
}
