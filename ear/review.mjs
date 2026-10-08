// The listening review's numbers: every clip you saved (Love this, This grates, Snapshot) since a date,
// grouped by engine, mood and reaction, as Markdown. A review session runs this first, then looks at the
// grates' spectrograms and Gemini's critiques, and writes docs/listening/<date>.md with what to tune.
//
//   node ear/review.mjs [--since 2026-10-07] [--dir ~/.undertone/ear]
//
// Plain numbers from each clip's stats.json and state.json; nothing is sent anywhere.
//
// Loudness is the level you heard: the browser engines are recorded at the limiter, before your Volume
// and the mood's trim, so those are added back; SuperCollider records its own output after its level,
// which already includes both.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt }
const DIR = arg('--dir', path.join(process.env.UNDERTONE_HOME || path.join(os.homedir(), '.undertone'), 'ear'))
const SINCE = arg('--since', '0000-00-00')

export function loadClips(dir, since = '0000-00-00') {
  const out = []
  for (const day of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < since) continue
    for (const name of fs.readdirSync(path.join(dir, day)).sort()) {
      const d = path.join(dir, day, name)
      let s, st
      try { s = JSON.parse(fs.readFileSync(path.join(d, 'stats.json'), 'utf8')); st = JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8')) } catch { continue }
      const state = st.state || st
      const [, engine, kind] = name.split('-')
      out.push({
        id: day + '/' + name, day, hour: Number(name.slice(0, 2)), engine, kind, mood: state.mood || '?',
        rms: s.rmsDb + (engine === 'sc' ? 0 : (state.volume || 0) + (state.trim || 0)), peak: s.peakDb, crest: s.crestDb, clicks: s.clicksPerMinute, centroid: s.centroidHz, bands: s.bandsPercent || {},
        lanes: (state.lanes || []).filter((l) => !l.off).length, busy: (state.lanes || []).filter((l) => l.busy).length,
        tier: state.tier ?? null, drive: state.drive ?? null, volume: state.volume ?? null, note: st.note || '',
        critique: fs.existsSync(path.join(d, 'critique.md')),
      })
    }
  }
  return out
}

const median = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
const r1 = (x) => (x == null ? '–' : Math.round(x * 10) / 10)
const count = (xs, key) => xs.reduce((m, x) => (m[key(x)] = (m[key(x)] || 0) + 1, m), {})

function row(label, sel) {
  const b = (k) => r1(median(sel.map((c) => c.bands[k] ?? 0)))
  return `| ${label} | ${sel.length} | ${r1(median(sel.map((c) => c.rms)))} | ${r1(median(sel.map((c) => c.peak)))} | ${r1(median(sel.map((c) => c.centroid)))} | ${b('sub')} / ${b('bass')} / ${b('lowMid')} / ${b('mid')} / ${b('presence')} | ${sel.filter((c) => c.clicks > 0).length} |`
}
const HEAD = '| | clips | heard RMS dB | peak dB | centroid Hz | sub / bass / low-mid / mid / presence % | with clicks |\n| :- | -: | -: | -: | -: | :- | -: |'

export function report(clips, since) {
  const L = []
  const kinds = count(clips, (c) => c.kind)
  L.push(`# Listening numbers${since && since !== '0000-00-00' ? ' since ' + since : ''}`, '')
  L.push(`${clips.length} clips: ${kinds.love || 0} loved, ${kinds.grates || 0} grated, ${kinds.snapshot || 0} snapshots, ${clips.filter((c) => c.critique).length} with a Gemini critique.`, '')
  L.push('By day: ' + Object.entries(count(clips, (c) => c.day)).map(([d, n]) => `${d.slice(5)} ${n}`).join(', ') + '.', '')
  L.push('## Loved, by engine', '', HEAD)
  for (const e of ['synth', 'sampled', 'strudel', 'sc']) { const s = clips.filter((c) => c.engine === e && c.kind === 'love'); if (s.length) L.push(row(e, s)) }
  L.push('', '## Loved, by mood', '', HEAD)
  for (const m of [...new Set(clips.map((c) => c.mood))].sort()) { const s = clips.filter((c) => c.mood === m && c.kind === 'love'); if (s.length) L.push(row(m, s)) }
  const moodRms = [...new Set(clips.map((c) => c.mood))].map((m) => [m, median(clips.filter((c) => c.mood === m && c.kind === 'love').map((c) => c.rms))]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])
  if (moodRms.length > 1) L.push('', `Loudness spread between moods: ${r1(moodRms[0][1] - moodRms.at(-1)[1])} dB (${moodRms[0][0]} loudest, ${moodRms.at(-1)[0]} quietest).`)
  const grates = clips.filter((c) => c.kind === 'grates')
  L.push('', '## Grated, one by one', '')
  if (!grates.length) L.push('None.')
  else {
    L.push('| clip | engine | mood | RMS | peak | centroid | sub / bass / low-mid % | busy lanes | tier | note |', '| :- | :- | :- | -: | -: | -: | :- | -: | -: | :- |')
    for (const g of grates) L.push(`| ${g.id} | ${g.engine} | ${g.mood} | ${r1(g.rms)} | ${r1(g.peak)} | ${r1(g.centroid)} | ${r1(g.bands.sub)} / ${r1(g.bands.bass)} / ${r1(g.bands.lowMid)} | ${g.busy} | ${g.tier ?? '–'} | ${g.note.replace(/\|/g, '/').slice(0, 80)} |`)
    for (const e of [...new Set(grates.map((g) => g.engine))]) {
      const loved = clips.filter((c) => c.engine === e && c.kind === 'love')
      if (loved.length) L.push('', `Against the same engine's loves (${e}):`, '', HEAD, row(e + ' loved', loved), row(e + ' grated', grates.filter((g) => g.engine === e)))
    }
  }
  const clicky = clips.filter((c) => c.clicks > 0)
  L.push('', '## Faults', '', `Clips with clicks: ${clicky.length}${clicky.length ? ' (' + clicky.slice(0, 8).map((c) => c.id).join(', ') + (clicky.length > 8 ? ', ...' : '') + ')' : ''}.`)
  L.push(`Clipped (peak at 0 dB): ${clips.filter((c) => c.peak >= -0.1).length}. Peaks above -6 dB: ${clips.filter((c) => c.peak > -6).length}.`)
  L.push('', 'Loves by hour: ' + Object.entries(count(clips.filter((c) => c.kind === 'love'), (c) => c.hour)).map(([h, n]) => `${h}h ${n}`).join(', ') + '.')
  return L.join('\n') + '\n'
}

if (import.meta.url === 'file://' + process.argv[1]) process.stdout.write(report(loadClips(DIR, SINCE), SINCE))
