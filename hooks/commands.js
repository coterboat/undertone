// What a Bash command did, as far as undertone cares: did it commit, did it push, which checks
// (tests, typecheck, lint, build) did it run, and can its exit code be trusted as theirs.
// Pure; only booleans and short check names come out, never the command.
//
//   analyzeCommand(cmd)        -> { commit, push, checks: [{ check, reportable }] }
//   outcomes(analysis, ok)     -> the events to send: commit, push, pass/fail with `check`

const base = (w) => String(w || '').split('/').pop()

// Heredoc bodies are data, not commands: drop the lines up to the closing word
function stripHeredocs(cmd) {
  const out = []
  let end = null
  for (const line of String(cmd).split('\n')) {
    if (end) { if (line.trim() === end) end = null; continue }
    out.push(line)
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (m) end = m[2]
  }
  return out.join('\n')
}

// Splits on unquoted && || ; | & and newlines. Quoted strings are emptied (so a commit message
// can't look like a command) and comments dropped. Each segment remembers the operator after it.
function segments(cmd) {
  const segs = []
  let cur = ''
  let q = null
  const cut = (op) => { if (cur.trim()) segs.push({ text: cur.trim(), op }); else if (segs.length && op) segs[segs.length - 1].op = segs[segs.length - 1].op || op; cur = '' }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    const n = cmd[i + 1]
    if (q) {
      if (c === '\\' && q === '"') { i++; continue }
      if (c === q) { q = null; cur += '""' }
      continue
    }
    if (c === "'" || c === '"') { q = c; continue }
    if (c === '\\') { cur += n || ''; i++; continue }
    if (c === '#' && (i === 0 || /\s/.test(cmd[i - 1]))) { while (i + 1 < cmd.length && cmd[i + 1] !== '\n') i++; continue }
    if (c === '\n' || c === ';') { cut(';'); continue }
    if (c === '&' && n === '&') { cut('&&'); i++; continue }
    if (c === '|' && n === '|') { cut('||'); i++; continue }
    if (c === '|') { cut('|'); if (n === '&') i++; continue }
    if (c === '&' && n !== '>' && cmd[i - 1] !== '>' && cmd[i - 1] !== '<') { cut('&'); continue }
    cur += c
  }
  cut(null)
  return segs
}

const WRAPPERS = new Set(['time', 'env', 'sudo', 'nohup', 'command', 'exec'])
function words(text) {
  const ws = text.split(/\s+/).filter(Boolean)
  while (ws.length && (WRAPPERS.has(ws[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0]))) ws.shift()
  return ws
}

function scriptCheck(script) {
  const s = String(script || '').toLowerCase()
  if (/^tests?($|:)/.test(s) || s === 'e2e') return 'test'
  if (/typecheck|type-check|^tsc$|^types$/.test(s)) return 'typecheck'
  if (/^lint/.test(s)) return 'lint'
  if (/^build/.test(s)) return 'build'
  if (s === 'check') return 'checks'
  return null
}

// The check a segment runs, as "<family>" or "<family>:<tool>" when the tool says something
function classify(ws) {
  const cmd = base(ws[0])
  const rest = ws.slice(1)
  const sub = rest.find((w) => !w.startsWith('-'))
  switch (cmd) {
    case 'npm': case 'pnpm': case 'yarn': case 'bun': {
      if (cmd === 'bun' && rest[0] === 'test') return 'test:bun'
      let script = rest[0]
      if (script === 'run' || script === 'run-script') script = rest.slice(1).find((w) => !w.startsWith('-'))
      if (cmd === 'npm' && script === 't') script = 'test'
      return scriptCheck(script)
    }
    case 'npx': case 'pnpx': case 'bunx': {
      const i = rest.findIndex((w) => !w.startsWith('-'))
      return i < 0 ? null : classify(rest.slice(i))
    }
    case 'tsc': return 'typecheck:tsc'
    case 'jest': case 'vitest': case 'mocha': case 'playwright': case 'pytest': return 'test:' + cmd
    case 'mypy': return 'typecheck:mypy'
    case 'eslint': return 'lint:eslint'
    case 'ruff': return sub === 'check' ? 'lint:ruff' : null
    case 'python': case 'python3': {
      const i = rest.indexOf('-m')
      const mod = i >= 0 ? rest[i + 1] : null
      return { pytest: 'test:pytest', unittest: 'test:unittest', mypy: 'typecheck:mypy', py_compile: 'typecheck:python' }[mod] || null
    }
    case 'dotnet': return { build: 'build:dotnet', test: 'test:dotnet' }[sub] || null
    case 'cargo': return { build: 'build:cargo', test: 'test:cargo', check: 'typecheck:cargo', clippy: 'lint:cargo' }[sub] || null
    case 'go': return { build: 'build:go', test: 'test:go', vet: 'lint:go' }[sub] || null
    case 'make': {
      const target = rest.find((w) => !w.startsWith('-') && !w.includes('='))
      if (!target) return 'build'
      return { test: 'test', check: 'checks', build: 'build', lint: 'lint', typecheck: 'typecheck' }[target] || null
    }
    case 'claude': return rest[0] === 'plugin' && rest[1] === 'test' ? 'test:claude' : null
    case 'node': return rest.includes('--test') ? 'test:node' : null
    default: return null
  }
}

// git's subcommand after its global options (-C dir, -c k=v, --no-pager, ...)
function gitSub(ws) {
  if (base(ws[0]) !== 'git') return null
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i]
    if (w === '-C' || w === '-c' || w === '--git-dir' || w === '--work-tree' || w === '--namespace') { i++; continue }
    if (w.startsWith('-')) continue
    return { sub: w, args: ws.slice(i + 1) }
  }
  return null
}

export function analyzeCommand(cmd) {
  const segs = segments(stripHeredocs(cmd))
  const result = { commit: false, push: false, checks: [] }
  let pipefail = false
  for (let k = 0; k < segs.length; k++) {
    const ws = words(segs[k].text)
    if (!ws.length) continue
    if (/\bpipefail\b/.test(segs[k].text)) pipefail = true
    const g = gitSub(ws)
    if (g && g.sub === 'commit' && !g.args.includes('--dry-run')) result.commit = true
    if (g && g.sub === 'push' && !g.args.includes('--dry-run') && !g.args.includes('-n')) result.push = true
    const check = classify(ws)
    if (!check) continue
    // The command's exit code is this check's only if nothing after it can mask it: from here to
    // the end only `&&` (and a pipe when pipefail is set). `;`, `||` (`|| true`), a plain pipe
    // (`| tail`) or `&` (background) all hide it.
    let reportable = true
    for (let j = k; j < segs.length - 1; j++) {
      const op = segs[j].op
      if (op === '&&') continue
      if (op === '|' && pipefail) continue
      reportable = false
      break
    }
    if (segs[segs.length - 1].op === '&') reportable = false
    result.checks.push({ check, reportable })
  }
  return result
}

// A failure with more than one check in the chain can't say which failed, so it says nothing
export function outcomes(a, ok) {
  const out = []
  if (ok && a.commit) out.push({ type: 'commit' })
  if (ok && a.push) out.push({ type: 'push' })
  const checks = a.checks.filter((c) => c.reportable)
  if (ok) for (const c of checks) out.push({ type: 'pass', check: c.check })
  else if (checks.length === 1) out.push({ type: 'fail', check: checks[0].check })
  return out
}
