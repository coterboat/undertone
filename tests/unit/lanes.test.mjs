import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reduce, sweep, snapshot, emptyState, isExternal, checkOf, checkLabel, sourFor, LANE_TTL_MS, IDLE_MS } from '../../lib/lanes.mjs'

const L = { lane: 'a1b2c3d4', project: 'jobsnearme', label: 'jobsnearme · lane-2' }
const run = (events, start = 1_000_000) => {
  let s = emptyState()
  events.forEach((e, i) => { s = reduce(s, { ...L, ...e }, start + i * 1000) })
  return s
}
const lane = (s, id = L.lane) => s.lanes[id]

test('work, a permission prompt, an idle wait and a finished turn move a lane between states', () => {
  let s = run([{ type: 'session.start' }])
  assert.equal(lane(s).state, 'working')
  assert.equal(lane(s).known, true)
  s = reduce(s, { ...L, type: 'attention', reason: 'permission' }, 2_000_000)
  assert.equal(lane(s).state, 'needs_ok')
  assert.equal(lane(s).needsSince, 2_000_000)
  s = reduce(s, { ...L, type: 'attention', reason: 'permission' }, 2_005_000)
  assert.equal(lane(s).needsSince, 2_000_000, 'a repeated prompt keeps when it started')
  s = reduce(s, { ...L, type: 'tool', tool: 'Bash' }, 2_010_000)
  assert.equal(lane(s).state, 'working')
  assert.equal(lane(s).needsSince, null)
  s = reduce(s, { ...L, type: 'turn.end' }, 2_020_000)
  assert.equal(lane(s).state, 'your_move')
  assert.equal(lane(s).needsReason, 'done')
  s = reduce(s, { ...L, type: 'attention', reason: 'idle' }, 2_080_000)
  assert.equal(lane(s).state, 'your_move')
  assert.equal(lane(s).needsReason, 'idle')
  s = reduce(s, { ...L, type: 'prompt' }, 2_090_000)
  assert.equal(lane(s).state, 'working')
})

test('a lane with no work for 15 minutes settles to idle; one that waits on you keeps waiting', () => {
  let s = run([{ type: 'session.start' }])
  s = reduce(s, { ...L, type: 'alive' }, 1_000_000 + IDLE_MS + 1000)
  s = sweep(s, 1_000_000 + IDLE_MS + 2000).state
  assert.equal(lane(s).state, 'idle')
  let w = run([{ type: 'session.start' }, { type: 'attention', reason: 'permission' }])
  w = reduce(w, { ...L, type: 'alive' }, 1_000_000 + IDLE_MS + 1000)
  w = sweep(w, 1_000_000 + IDLE_MS + 2000).state
  assert.equal(lane(w).state, 'needs_ok')
})

test('three silent minutes, or session.end, remove a lane', () => {
  const s = run([{ type: 'session.start' }])
  const r = sweep(s, 1_000_000 + LANE_TTL_MS + 1)
  assert.deepEqual(r.removed, [L.lane])
  assert.equal(lane(r.state), undefined)
  assert.equal(lane(run([{ type: 'session.start' }, { type: 'session.end' }])), undefined)
})

test('two checks fail and clear on their own; a passing lint leaves failing tests', () => {
  let s = run([{ type: 'session.start' }, { type: 'fail', check: 'test' }, { type: 'fail', check: 'lint' }, { type: 'pass', check: 'lint' }])
  assert.deepEqual(Object.keys(lane(s).failing), ['test'])
  s = reduce(s, { ...L, type: 'pass', check: 'test' }, 9_999_999)
  assert.deepEqual(Object.keys(lane(s).failing), [])
})

test('a lane whose first event is a failing command is not an outside source; origin or src- makes one', () => {
  const s = run([{ type: 'fail', source: 'command' }])
  assert.equal(lane(s).external, false)
  assert.equal(checkOf({ source: 'checks' }), 'checks')
  assert.equal(checkOf({ source: 'command' }), 'build')
  const ext = reduce(emptyState(), { type: 'pulse', lane: 'src-ourplace', project: 'ourplace', origin: 'azure', count: 3 }, 1)
  assert.equal(lane(ext, 'src-ourplace').external, true)
  assert.equal(isExternal({ lane: 'src-x' }), true)
  assert.equal(isExternal({ lane: 'a1b2c3d4', source: 'command' }), false)
})

test('a pulse counts as work only for an outside source, and never makes it wait on you', () => {
  let s = reduce(emptyState(), { type: 'session.start', lane: 'src-ourplace', project: 'ourplace', origin: 'azure' }, 1000)
  s = reduce(s, { type: 'turn.end', lane: 'src-ourplace', origin: 'azure' }, 2000)
  s = reduce(s, { type: 'attention', reason: 'permission', lane: 'src-ourplace', origin: 'azure' }, 3000)
  s = reduce(s, { type: 'pulse', lane: 'src-ourplace', origin: 'azure', count: 2 }, 4000)
  assert.equal(lane(s, 'src-ourplace').state, 'working')
  assert.equal(lane(s, 'src-ourplace').lastWork, 4000)
  const claude = run([{ type: 'session.start' }, { type: 'pulse', count: 1 }])
  assert.equal(lane(claude).lastWork, 1_000_000)
})

test('a scheduled run never waits on you after a turn or an idle prompt, but a permission prompt still blocks it', () => {
  let s = run([{ type: 'session.start' }, { type: 'prompt', scheduled: true }, { type: 'turn.end' }])
  assert.equal(lane(s).scheduled, true)
  assert.equal(lane(s).state, 'idle')
  s = reduce(s, { ...L, type: 'attention', reason: 'idle' }, 9_000_000)
  assert.notEqual(lane(s).state, 'your_move')
  s = reduce(s, { ...L, type: 'attention', reason: 'permission' }, 9_100_000)
  assert.equal(lane(s).state, 'needs_ok')
})

test('waiting snapshots replace the counts; the snapshot lists failing checks', () => {
  let s = reduce(emptyState(), { type: 'waiting', projects: { jobsnearme: 4 } }, 1)
  s = reduce(s, { type: 'waiting', projects: { undertone: 1 } }, 2)
  s = reduce(s, { ...L, type: 'fail', check: 'typecheck' }, 3)
  const snap = snapshot(s, 4)
  assert.deepEqual(snap.waitingBy, { undertone: 1 })
  assert.deepEqual(snap.lanes[0].failingChecks, ['typecheck'])
  assert.equal(snap.ok, true)
})

test('check names read as words, and each kind of failure gets its own sour note', () => {
  assert.equal(checkLabel('test:vitest'), 'tests (vitest)')
  assert.equal(checkLabel('prod-errors:Http5xx'), 'prod errors (Http5xx)')
  assert.equal(checkLabel('typecheck'), 'typecheck')
  const root = 53 // F
  const notes = ['test', 'typecheck', 'lint', 'build', 'prod-errors:Http5xx'].map((c) => sourFor(c, root))
  assert.equal(new Set(notes).size, notes.length, 'every kind sounds different')
  assert.equal((sourFor('test', root) - root) % 12, 6, 'tests keep the tritone')
  assert.ok(sourFor('prod-errors', root) < 54, 'production errors rumble low')
})

test('a lane first heard from by a heartbeat or a failure starts idle, not working', () => {
  assert.equal(lane(run([{ type: 'alive' }])).state, 'idle')
  assert.equal(lane(run([{ type: 'fail', check: 'test' }])).state, 'idle')
  assert.equal(lane(run([{ type: 'alive' }, { type: 'tool', tool: 'Read' }])).state, 'working')
})
