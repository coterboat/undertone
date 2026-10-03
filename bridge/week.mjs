// npm run week [days]: the last week (or N days) per project, across every machine that syncs the
// brain. Reads the summaries and this machine's own log directly; no bridge needed.

import os from 'node:os'
import path from 'node:path'
import { readWeek, formatWeek } from './timesheets.mjs'

const days = Math.max(1, Math.min(31, Number(process.argv[2]) || 7))
const home = process.env.UNDERTONE_HOME || path.join(os.homedir(), '.undertone')
const week = readWeek({ logDir: path.join(home, 'log'), days })
console.log(process.argv.includes('--json') ? JSON.stringify(week, null, 2) : formatWeek(week))
