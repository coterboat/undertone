// Starts the bridge so it belongs to no session: its own process group, no console window, output to
// ~/.undertone/bridge.log. The mod runs this when no bridge answers; it returns at once.
//   node bridge/launch.mjs [port] [--auto] [--resume]
// The same on macOS, Linux and Windows (node's detached spawn), so no shell or PowerShell quoting.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = process.env.UNDERTONE_HOME || path.join(os.homedir(), '.undertone')
const LOG = path.join(HOME, 'bridge.log')
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs')

fs.mkdirSync(HOME, { recursive: true })
// A few lines per start; keep one old file past 1 MB
try { if (fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, LOG + '.1') } catch {}
const out = fs.openSync(LOG, 'a')
fs.writeSync(out, new Date().toISOString() + ' launch ' + process.argv.slice(2).join(' ') + '\n')

const child = spawn(process.execPath, [SERVER, ...process.argv.slice(2)], {
  detached: true,
  windowsHide: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log(JSON.stringify({ ok: true, pid: child.pid, log: LOG }))
