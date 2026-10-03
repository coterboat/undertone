// Where SuperCollider's language (sclang) lives. UNDERTONE_SCLANG wins; otherwise the usual
// places on a Mac or Linux, and on Windows the newest C:\Program Files\SuperCollider-*\sclang.exe.
// Everything it touches is passed in, so it can be tested with a fake file list.

import fs from 'node:fs'

const UNIX = [
  '/Applications/SuperCollider.app/Contents/MacOS/sclang',
  '/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang',
  '/usr/bin/sclang',
  '/usr/local/bin/sclang',
]

const listDir = (d) => { try { return fs.readdirSync(d) } catch { return [] } }

export function findSclang({ platform = process.platform, env = process.env, exists = fs.existsSync, list = listDir } = {}) {
  if (env.UNDERTONE_SCLANG) return env.UNDERTONE_SCLANG
  if (platform === 'win32') {
    for (const root of [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      const versions = list(root).filter((n) => /^SuperCollider/i.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const v of versions) {
        const p = root + '\\' + v + '\\sclang.exe'
        if (exists(p)) return p
      }
    }
    return null
  }
  return UNIX.find((p) => exists(p)) || null
}
