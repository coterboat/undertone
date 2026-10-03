// Old ear clips and daily logs, deleted only if you ask for it: UNDERTONE_EAR_DAYS and
// UNDERTONE_LOG_DAYS (0, the default, keeps everything). Clips are what teaches Claude to hear and
// the logs are your timesheet history, so neither expires by default.
//
// prune({ home, earDays, logDays, now }) -> { earDays: [deleted day folders], logs: [deleted files] }
// A day's clip folder goes once the whole day is older than the limit; its lines in
// ear/index.jsonl stay, marked "pruned": true.

import fs from 'node:fs'
import path from 'node:path'

const DAY_MS = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})/
const startOf = (name) => { const m = DATE.exec(name); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null }
const list = (d) => { try { return fs.readdirSync(d) } catch { return [] } }

export function prune({ home, earDays = 0, logDays = 0, now = Date.now() }) {
  const out = { earDays: [], logs: [] }
  if (earDays > 0) {
    const earDir = path.join(home, 'ear')
    for (const name of list(earDir)) {
      const start = startOf(name)
      if (start == null || !/^\d{4}-\d{2}-\d{2}$/.test(name) || start + DAY_MS > now - earDays * DAY_MS) continue
      fs.rmSync(path.join(earDir, name), { recursive: true, force: true })
      out.earDays.push(name)
    }
    const index = path.join(earDir, 'index.jsonl')
    if (out.earDays.length && fs.existsSync(index)) {
      const gone = out.earDays.map((d) => path.join(earDir, d) + path.sep)
      const lines = fs.readFileSync(index, 'utf8').split('\n').map((line) => {
        if (!line.trim()) return line
        try {
          const row = JSON.parse(line)
          return row.dir && gone.some((g) => (row.dir + path.sep).startsWith(g)) && !row.pruned ? JSON.stringify({ ...row, pruned: true }) : line
        } catch {
          return line
        }
      })
      fs.writeFileSync(index, lines.join('\n'))
    }
  }
  if (logDays > 0) {
    const logDir = path.join(home, 'log')
    for (const name of list(logDir)) {
      const start = startOf(name)
      if (start == null || !name.endsWith('.jsonl') || start + DAY_MS > now - logDays * DAY_MS) continue
      fs.unlinkSync(path.join(logDir, name))
      out.logs.push(name)
    }
  }
  return out
}
