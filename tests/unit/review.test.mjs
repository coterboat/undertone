import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadClips, report } from '../../ear/review.mjs'

function clip(dir, day, name, stats, state) {
  const d = path.join(dir, day, name)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'stats.json'), JSON.stringify(stats))
  fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ kind: name.split('-')[2], note: '', state }))
}

test('the listening numbers group clips by engine, mood and reaction, and set grates against loves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-review-'))
  const s = (rms, sub) => ({ rmsDb: rms, peakDb: rms + 12, crestDb: 12, clicksPerMinute: 0, centroidHz: 300, bandsPercent: { sub, bass: 40, lowMid: 20, mid: 5, presence: 1 } })
  clip(dir, '2026-10-06', '220000-sc-love', s(-28, 25), { mood: 'deepfield', lanes: [{ busy: true }] })
  clip(dir, '2026-10-07', '221614-sc-grates', s(-25, 48), { mood: 'house', tier: 2, lanes: [] })
  clip(dir, '2026-10-07', '221700-sampled-love', s(-22, 10), { mood: 'house', lanes: [] })
  fs.mkdirSync(path.join(dir, '2026-10-07', 'broken-sc-love'))
  const all = loadClips(dir)
  assert.equal(all.length, 3, 'a folder without stats is skipped')
  assert.equal(loadClips(dir, '2026-10-07').length, 2)
  const md = report(all)
  assert.match(md, /3 clips: 2 loved, 1 grated/)
  assert.match(md, /\| 2026-10-07\/221614-sc-grates \| sc \| house \| -25 /)
  assert.match(md, /\| sc grated \| 1 \| -25 /)
  assert.match(md, /Loudness spread between moods: 6 dB \(house loudest, deepfield quietest\)/)
})
