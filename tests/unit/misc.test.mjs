import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { countWaiting } from '../../hooks/waiting.js'
import { promptFor } from '../../ear/gemini.mjs'
import { findSclang } from '../../bridge/sclang.mjs'
import { prune } from '../../bridge/retention.mjs'
import { eventsFor, makeSource, azInvocation } from '../../sources/azure-metrics.mjs'

const NOW = Date.UTC(2026, 9, 3, 12)
const DAY = 86_400_000

test('the same question saved twice counts once; answered and expired ones count zero; threads and handoffs never count', () => {
  const rows = [
    { id: 'a', at: NOW - 60_000, device: 'pc', project: 'jobsnearme', kind: 'waiting', text: 'Q15  302 ok?', status: 'active' },
    { id: 'b', at: NOW - 30_000, device: 'mac', project: 'jobsnearme', kind: 'waiting', text: 'q15 302 OK?', status: 'active' },
    { id: 'c', at: NOW - 60_000, project: 'jobsnearme', kind: 'waiting', text: 'Q16 sign FS-310', status: 'active' },
    { op: 'status', ref: 'c', status: 'superseded', at: NOW - 10_000 },
    { id: 'd', at: NOW - 31 * DAY, project: 'ourplace', kind: 'waiting', text: 'too old', status: 'active' },
    { id: 'e', at: NOW - DAY, project: 'jobsnearme', kind: 'thread', text: 'owner questions open: Q17?', status: 'active' },
    { id: 'f', at: NOW - 8 * DAY, project: 'coter-kit', kind: 'handoff', text: 'pick this up', status: 'active' },
  ]
  assert.deepEqual(countWaiting(rows, NOW), { jobsnearme: 1 })
})

test("a reaction's note goes to Gemini only with UNDERTONE_GEMINI_NOTE=1", () => {
  const meta = { kind: 'grates', note: 'the hats on jobsnearme', state: { engine: 'synth', key: 'D major', bpm: 92, texture: 0.2 } }
  const stats = { seconds: 20 }
  delete process.env.UNDERTONE_GEMINI_NOTE
  assert.doesNotMatch(promptFor(meta, stats), /hats on jobsnearme/)
  process.env.UNDERTONE_GEMINI_NOTE = '1'
  assert.match(promptFor(meta, stats), /hats on jobsnearme/)
  delete process.env.UNDERTONE_GEMINI_NOTE
})

test('SuperCollider is found on Windows in the newest Program Files folder', () => {
  const files = new Set(['C:\\Program Files\\SuperCollider-3.13.0\\sclang.exe', 'C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe'])
  const found = findSclang({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    exists: (p) => files.has(p),
    list: (d) => (d === 'C:\\Program Files' ? ['Common Files', 'SuperCollider-3.13.0', 'SuperCollider-3.14.1'] : []),
  })
  assert.equal(found, 'C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe')
  assert.equal(findSclang({ platform: 'darwin', env: { UNDERTONE_SCLANG: '/opt/sc/sclang' }, exists: () => false }), '/opt/sc/sclang')
  assert.equal(findSclang({ platform: 'win32', env: {}, exists: () => false, list: () => [] }), null)
})

test('pruning deletes only clip days and logs past the limit, marks their index lines, and keeps everything at 0', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'undertone-prune-'))
  const mk = (p, body = '') => { fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), body) }
  const today = new Date(NOW).toISOString().slice(0, 10)
  mk('ear/2026-07-01/101010-synth-love/clip.wav', 'x')
  mk(`ear/${today}/101010-synth-love/clip.wav`, 'x')
  mk('log/2026-01-01.jsonl', '{}\n')
  mk(`log/${today}.jsonl`, '{}\n')
  const oldDir = path.join(home, 'ear', '2026-07-01', '101010-synth-love')
  const newDir = path.join(home, 'ear', today, '101010-synth-love')
  mk('ear/index.jsonl', JSON.stringify({ dir: oldDir }) + '\n' + JSON.stringify({ dir: newDir }) + '\n')

  assert.deepEqual(prune({ home, earDays: 0, logDays: 0, now: NOW }), { earDays: [], logs: [] })
  assert.ok(fs.existsSync(oldDir))

  const r = prune({ home, earDays: 30, logDays: 180, now: NOW })
  assert.deepEqual(r, { earDays: ['2026-07-01'], logs: ['2026-01-01.jsonl'] })
  assert.ok(!fs.existsSync(oldDir))
  assert.ok(fs.existsSync(newDir))
  assert.ok(fs.existsSync(path.join(home, 'log', today + '.jsonl')))
  const index = fs.readFileSync(path.join(home, 'ear', 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(index.map((r) => !!r.pruned), [true, false])
  fs.rmSync(home, { recursive: true, force: true })
})

test("Azure errors become a named prod-errors check on an outside source's lane, each minute played once", () => {
  const lane = { lane: 'src-ourplace', project: 'ourplace', label: 'ourPlace prod', origin: 'azure' }
  const m = { metric: 'Http5xx', as: 'errors', failAt: 3 }
  const memo = {}
  const minute = (ago, total) => ({ t: NOW - ago * 60_000, total })
  assert.deepEqual(eventsFor(lane, m, [minute(4, 4)], memo, NOW), [{ type: 'fail', ...lane, check: 'prod-errors:Http5xx' }])
  assert.deepEqual(eventsFor(lane, m, [minute(4, 4)], memo, NOW), [], 'the same minute again plays nothing')
  assert.deepEqual(eventsFor(lane, m, [minute(3.5, 0)], memo, NOW + 60_000), [{ type: 'pass', ...lane, check: 'prod-errors:Http5xx' }])
  const pulses = eventsFor(lane, { metric: 'Requests', as: 'pulse', what: 'chats' }, [minute(4, 2), minute(3.5, 3)], {}, NOW)
  assert.deepEqual(pulses, [{ type: 'pulse', ...lane, count: 5, what: 'chats', kind: 'chime' }])
})

test('az runs through cmd.exe on Windows (it is az.cmd there) and only with plain arguments', () => {
  const id = '/subscriptions/018bee08-f08e/resourceGroups/prod/providers/Microsoft.Web/sites/JoinOurPlace'
  const args = ['monitor', 'metrics', 'list', '--resource', id, '--metric', 'Http5xx', '--start-time', '2026-10-03T18:00:00.000Z', '-o', 'json']
  assert.deepEqual(azInvocation(args, 'win32'), { file: 'az.cmd', args, shell: true })
  assert.deepEqual(azInvocation(args, 'darwin'), { file: 'az', args, shell: false })
  for (const bad of ['two words', 'Requests&calc', '"quoted"', 'a|b', '%PATH%', '^x', 'a>b'])
    assert.throws(() => azInvocation(['--metric', bad], 'win32'), /refusing/, bad)
})

test('a slow az call never lets two ticks run at once, so no minute plays twice', async () => {
  let calls = 0
  const sent = []
  const az = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 50))
    return { value: [{ timeseries: [{ data: [{ timeStamp: new Date(NOW - 4 * 60_000).toISOString(), total: 2 }] }] }] }
  }
  const src = makeSource('ourplace', { metrics: [{ resource: 'r', metric: 'Requests', as: 'pulse' }] }, { az, send: async (e) => sent.push(...e), clock: () => NOW })
  const [a, b] = await Promise.all([src.tick(), src.tick()])
  assert.deepEqual([a, b].sort(), [false, true])
  assert.equal(calls, 1)
  await src.tick()
  assert.equal(sent.filter((e) => e.type === 'pulse').length, 1)
})

test('package.json and the plugin manifest carry the same version', () => {
  const root = path.resolve(import.meta.dirname, '..', '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(pkg.version, plugin.version)
})
