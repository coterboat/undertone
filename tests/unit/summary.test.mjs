import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { summarizeDay, mergeSummaries } from '../../lib/summary.mjs'
import { writeSummaries, readWeek, formatWeek, deviceName } from '../../bridge/timesheets.mjs'

const T0 = new Date(2026, 9, 3, 9, 0, 0).getTime() // 09:00 local
const M = 60_000
const at = (min, e) => ({ ts: T0 + min * M, ...e })
const A = { lane: 'aaaa0001', project: 'jobsnearme', label: 'jobsnearme' }
const B = { lane: 'bbbb0002', project: 'jobsnearme', label: 'jobsnearme · lane-2' }

// Lane A works 0-10 min, waits on a permission prompt 12-20, fails tests 3-7; lane B works 5-10 alongside it
const day = [
  at(0, { type: 'session.start', ...A }), at(0, { type: 'prompt', ...A }), at(0, { type: 'turn.start', ...A }),
  at(2, { type: 'tool', ...A }), at(3, { type: 'fail', check: 'test', ...A }), at(4, { type: 'tool', ...A }),
  at(5, { type: 'session.start', ...B }), at(5, { type: 'turn.start', ...B }),
  at(6, { type: 'tool', ...A }), at(7.5, { type: 'pass', check: 'test', ...A }), at(8, { type: 'tool', ...A }), at(8, { type: 'commit', ...A }),
  at(10.5, { type: 'turn.end', ...A }), at(10.5, { type: 'turn.end', ...B }),
  at(12, { type: 'attention', reason: 'permission', ...A }), at(15, { type: 'alive', ...A }), at(15, { type: 'alive', ...B }),
  at(20.2, { type: 'tool', ...A }), at(20.5, { type: 'turn.end', ...A }),
  // Open sessions send a heartbeat every minute
  ...Array.from({ length: 30 }, (_, i) => at(i + 0.9, { type: 'alive', ...A })),
  ...Array.from({ length: 25 }, (_, i) => at(i + 5.9, { type: 'alive', ...B })),
]

test('minutes worked, in parallel, blocked on you and broken add up from a day of events', () => {
  const s = summarizeDay(day, { date: '2026-10-03', device: 'mac' })
  const p = s.projects.jobsnearme
  assert.equal(p.activeMin, 11) // minutes 0-9 and minute 20
  assert.equal(p.laneMin, 16) // plus lane B's minutes 5-9
  assert.equal(p.blockedMin, 8) // minutes 12-19
  assert.deepEqual(p.brokenMin, { test: 4 }) // failing at the end of minutes 3-6 (it passed at 7:30)
  assert.equal(p.sessions, 2)
  assert.equal(p.turns, 2)
  assert.equal(p.commits, 1)
  assert.equal(p.first, '09:00')
  assert.equal(p.last, '09:20')
})

test('a prompt left waiting all night counts an hour at most', () => {
  const s = summarizeDay([
    at(0, { type: 'session.start', ...A }), at(1, { type: 'attention', reason: 'permission', ...A }),
    ...Array.from({ length: 180 }, (_, i) => at(2 + i, { type: 'alive', ...A })),
  ], { date: '2026-10-03', device: 'mac' })
  assert.equal(s.projects.jobsnearme.blockedMin, 60)
})

test("a session carried over from yesterday isn't working until it does something; an idle one isn't noise", () => {
  const s = summarizeDay([...Array.from({ length: 30 }, (_, i) => at(i, { type: 'alive', ...A }))], { date: '2026-10-03', device: 'mac' })
  assert.deepEqual(s.projects, {})
})

test('outside sources add up their totals and error minutes, and never count as work', () => {
  const O = { lane: 'src-ourplace', project: 'ourplace', label: 'ourPlace prod', origin: 'azure' }
  const s = summarizeDay([
    at(0, { type: 'session.start', ...O }), at(0, { type: 'pulse', count: 3, what: 'chats', ...O }), at(1, { type: 'pulse', count: 2, what: 'chats', ...O }),
    at(1, { type: 'pulse', count: 40, what: 'requests', ...O }), at(1, { type: 'fail', check: 'prod-errors:Http5xx', ...O }), at(4, { type: 'pass', check: 'prod-errors:Http5xx', ...O }),
  ], { date: '2026-10-03', device: 'pc' })
  assert.deepEqual(s.sources.ourplace, { totals: { chats: 5, requests: 40 }, errorMin: 3 })
  assert.deepEqual(s.projects, {})
})

test('two machines add up per project and per day', () => {
  const mac = summarizeDay(day, { date: '2026-10-03', device: 'mac' })
  const pc = { v: 1, date: '2026-10-02', device: 'pc', projects: { jobsnearme: { activeMin: 30, laneMin: 60, blockedMin: 2, brokenMin: { lint: 4 }, sessions: 1, turns: 3, commits: 2, pushes: 1 } }, sources: {} }
  const w = mergeSummaries([mac, pc])
  assert.deepEqual(w.devices, ['mac', 'pc'])
  assert.deepEqual(w.projects.jobsnearme.perDay, { '2026-10-03': 11, '2026-10-02': 30 })
  assert.equal(w.projects.jobsnearme.activeMin, 41)
  assert.deepEqual(w.projects.jobsnearme.brokenMin, { test: 4, lint: 4 })
})

test("summaries go into the brain per device, only when the log is newer, and a week reads every machine's", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'undertone-ts-'))
  const logDir = path.join(root, 'log')
  const brain = path.join(root, 'brain')
  fs.mkdirSync(logDir, { recursive: true })
  fs.mkdirSync(path.join(brain, 'undertone', 'pc'), { recursive: true })
  const now = T0 + 30 * M
  fs.writeFileSync(path.join(logDir, '2026-10-03.jsonl'), day.map((e) => JSON.stringify(e)).join('\n') + '\n')
  fs.writeFileSync(path.join(brain, 'undertone', 'pc', '2026-10-02.json'), JSON.stringify({ v: 1, date: '2026-10-02', device: 'pc', projects: { ourplace: { activeMin: 90, laneMin: 90, blockedMin: 0, brokenMin: {}, sessions: 1, turns: 4, commits: 1, pushes: 0 } }, sources: {} }))

  assert.deepEqual(writeSummaries({ logDir, brain, device: 'mac', now }), ['2026-10-03'])
  assert.deepEqual(writeSummaries({ logDir, brain, device: 'mac', now }), [], 'unchanged logs are not rewritten')
  const written = JSON.parse(fs.readFileSync(path.join(brain, 'undertone', 'mac', '2026-10-03.json'), 'utf8'))
  assert.equal(written.projects.jobsnearme.activeMin, 11)

  const w = readWeek({ logDir, brain, device: 'mac', now })
  assert.equal(w.dates.length, 7)
  assert.equal(w.to, '2026-10-03')
  assert.deepEqual(w.devices, ['mac', 'pc'])
  assert.equal(w.projects.ourplace.activeMin, 90)
  assert.equal(w.projects.jobsnearme.activeMin, 11)
  assert.match(formatWeek(w), /ourplace[\s\S]*jobsnearme/) // most worked first
  assert.deepEqual(writeSummaries({ logDir, brain: path.join(root, 'no-brain'), device: 'mac', now }), [], 'no brain folder, nothing written')
  fs.rmSync(root, { recursive: true, force: true })
})

test("the device name follows coter-kit's", () => {
  assert.equal(deviceName({ COMPUTERNAME: 'BLD' }), 'bld')
  assert.equal(deviceName({ HOSTNAME: "Alex's MacBook Pro.local" }), 'alex-s-macbook-pro-local')
})
