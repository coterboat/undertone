// Timesheets: each machine writes a small summary per day (lib/summary.mjs) into coter-kit's brain,
// at <brain>/undertone/<device>/<date>.json, and coter-kit's sync carries it to your other machines.
// Raw logs stay where they were made. A week is every machine's summaries added up, with this
// machine's own days computed fresh from its log.
//
// The device name follows coter-kit's (COMPUTERNAME, HOSTNAME, or the short host name), so a
// machine's folders line up in the brain.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { summarizeDay, mergeSummaries } from '../lib/summary.mjs'

const DAY_MS = 86_400_000
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
export const deviceName = (env = process.env) => slug(env.COMPUTERNAME || env.HOSTNAME || os.hostname().split('.')[0]) || 'device'
export const brainDir = (env = process.env) => env.UNDERTONE_BRAIN_DIR || path.join(os.homedir(), '.claude', 'coter-brain')
export const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const lastDays = (now, days) => Array.from({ length: days }, (_, i) => ymd(now - (days - 1 - i) * DAY_MS))
const list = (d) => { try { return fs.readdirSync(d) } catch { return [] } }

function readLog(logDir, date) {
  let text
  try { text = fs.readFileSync(path.join(logDir, date + '.jsonl'), 'utf8') } catch { return null }
  const out = []
  for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)) } catch {} }
  return out
}

export function summaryFor({ logDir, date, device, now = Date.now() }) {
  return summarizeDay(readLog(logDir, date) || [], { date, device, now })
}

// This machine's summaries for the last `days` days, written where the log is newer than the summary.
// Nothing is written unless the brain folder is there.
export function writeSummaries({ logDir, brain = brainDir(), device = deviceName(), now = Date.now(), days = 7 }) {
  if (!fs.existsSync(brain)) return []
  const dir = path.join(brain, 'undertone', device)
  const written = []
  for (const date of lastDays(now, days)) {
    const log = path.join(logDir, date + '.jsonl')
    if (!fs.existsSync(log)) continue
    const file = path.join(dir, date + '.json')
    if (fs.existsSync(file) && fs.statSync(file).mtimeMs >= fs.statSync(log).mtimeMs) continue
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(summaryFor({ logDir, date, device, now }), null, 2) + '\n')
    written.push(date)
  }
  return written
}

// Every machine's last `days` days, added up per project
export function readWeek({ logDir, brain = brainDir(), device = deviceName(), now = Date.now(), days = 7 }) {
  const dates = lastDays(now, days)
  const summaries = []
  for (const date of dates) {
    for (const other of list(path.join(brain, 'undertone'))) {
      if (other === device) continue
      try { summaries.push(JSON.parse(fs.readFileSync(path.join(brain, 'undertone', other, date + '.json'), 'utf8'))) } catch {}
    }
    const mine = summaryFor({ logDir, date, device, now })
    if (Object.keys(mine.projects).length || Object.keys(mine.sources).length) summaries.push(mine)
  }
  const merged = mergeSummaries(summaries)
  return { from: dates[0], to: dates[dates.length - 1], dates, devices: merged.devices, projects: merged.projects, sources: merged.sources }
}

// The week as a few lines of text, for the terminal (npm run week)
export function formatWeek(w) {
  const hours = (min) => (min ? (min / 60).toFixed(1) : '·')
  const dur = (min) => (min >= 60 ? Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0') : min + 'm')
  const dayName = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)
  const names = Object.keys(w.projects).sort((a, b) => w.projects[b].activeMin - w.projects[a].activeMin)
  const width = Math.max(10, ...names.map((n) => n.length)) + 2
  const lines = [`undertone · ${w.from} to ${w.to} · ${w.devices.join(' + ') || 'no machines yet'}`, '']
  lines.push(''.padEnd(width) + w.dates.map((d) => dayName(d).padStart(5)).join('') + '  │   total  parallel  blocked   broken  commits')
  for (const n of names) {
    const p = w.projects[n]
    const broken = Object.values(p.brokenMin).reduce((a, b) => a + b, 0)
    lines.push(n.padEnd(width) + w.dates.map((d) => hours(p.perDay[d] || 0).padStart(5)).join('') + '  │' +
      (hours(p.activeMin) + 'h').padStart(8) + (hours(p.laneMin) + 'h').padStart(10) + dur(p.blockedMin).padStart(9) + dur(broken).padStart(9) + String(p.commits).padStart(9))
  }
  if (!names.length) lines.push('Nothing logged in these days yet.')
  const src = Object.entries(w.sources)
  if (src.length) {
    lines.push('')
    for (const [n, s] of src) lines.push(n + ': ' + Object.entries(s.totals).map(([k, v]) => v + ' ' + k).join(' · ') + ' · errors ' + dur(s.errorMin))
  }
  lines.push('', 'total: hours Claude worked on it · parallel: summed over sessions · blocked: waiting on your OK · broken: a check failing')
  return lines.join('\n')
}
