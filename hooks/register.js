// undertone: plays your Claude Code sessions as music.
//
// This mod sends what the session does (turns, tool calls, edits, commits, failing and
// passing checks, permission prompts, coter-kit's checklist) to the undertone bridge on
// 127.0.0.1, which streams it to the page in your browser, along with how many coter-kit
// questions wait on you in each project. Only event types, tool names, project names and
// those counts leave the session: never prompt text, file paths or commands.
//
//   /undertone          start the bridge if it isn't running and open the page
//   /undertone status   is the bridge up, and is this session sending
//   /undertone off|on   stop or resume sending this session's events
//   /undertone stop     stop the bridge, if this session started it

const DEFAULT_PORT = 4747
const CHECKLIST_TOOL = 'mcp__coter-kit__checklist'
const REMEMBER_TOOL = 'mcp__coter-kit__remember'
const DOWN_BACKOFF_MS = 15_000
const HEARTBEAT_MS = 60_000
const WAITING_EVERY_MS = 120_000
const WAITING_TTL_MS = 30 * 86_400_000 // coter-kit drops an unanswered question after 30 days

// Commands whose pass or fail is the build's state: tests, typechecks, builds, linters
const CHECK_CMD = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|typecheck|type-check|lint|check)|npx\s+(?:tsc|jest|vitest|eslint|playwright)|tsc|jest|vitest|pytest|mypy|ruff\s+check|dotnet\s+(?:build|test)|cargo\s+(?:build|test|check)|go\s+(?:build|test|vet)|python3?\s+-m\s+(?:pytest|py_compile|mypy|unittest)|make)\b/
const COMMIT_CMD = /\bgit\b[^|;&]*\bcommit\b/
const PUSH_CMD = /\bgit\b[^|;&]*\bpush\b/

let port = DEFAULT_PORT
let base = 'http://127.0.0.1:' + DEFAULT_PORT
let lane = null // { lane, project, label }
let sending = true
let queue = []
let flushTimer = null
let downUntil = 0
let bridge = null // the bridge process this session started, if any
let checksFailing = false
let brainDir = ''
let lastWaiting = ''

function kindOf(tool) {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Bash|PowerShell)$/.test(tool)) return 'run'
  if (/^(WebFetch|WebSearch)$/.test(tool) || /browser|chrome/i.test(tool)) return 'web'
  if (/^(Agent|Task)$/.test(tool)) return 'agent'
  return 'other'
}

// mcp__server__tool -> tool, so the page never sees server ids
const shortTool = (tool) => String(tool || '').split('__').pop().slice(0, 40)

// A worktree under .claude/worktrees/<name> plays as "<project> · <name>"
function laneFor(root, id) {
  const parts = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  let project = parts[parts.length - 1] || 'session'
  let label = project
  const wt = parts.lastIndexOf('worktrees')
  if (wt > 1 && parts[wt - 1] === '.claude' && parts[wt + 1]) {
    project = parts[wt - 2] || project
    label = project + ' · ' + parts[wt + 1]
  }
  return { lane: String(id || 'session').slice(0, 8), project, label }
}

function emit($, type, extra) {
  if (!lane || !sending) return
  queue.push({ type, ...lane, ...extra })
  if (queue.length > 100) queue.splice(0, queue.length - 100)
  if (!flushTimer) flushTimer = $.clock.after(120, () => { flushTimer = null; return flush($) })
}

// Batches go out about every 120 ms; when the bridge is down, events are dropped for 15 s
async function flush($) {
  if (!queue.length) return
  const batch = queue
  queue = []
  const now = await $.clock.now()
  if (now < downUntil) return
  try {
    const r = await $.http.fetch(base + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) })
    if (!r.ok) downUntil = now + DOWN_BACKOFF_MS
  } catch {
    downUntil = now + DOWN_BACKOFF_MS
  }
}

// ---------------------------------------------------------------- waiting on you (coter-kit's brain)

const safeJson = (line) => { try { return JSON.parse(line) } catch { return null } }

async function listDir($, dir) {
  try {
    return await $.fs.list(dir)
  } catch {
    return []
  }
}

async function readText($, path) {
  try {
    const r = await $.fs.read(path)
    return typeof r === 'string' ? r : r && typeof r.text === 'string' ? r.text : ''
  } catch {
    return ''
  }
}

// Open questions per project, read the way coter-kit reads them: every machine's journal,
// status changes applied in order, unanswered ones dropped after 30 days
async function readWaiting($) {
  let dir = brainDir
  if (!dir) {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
    if (!home) return {}
    dir = String(home).replace(/\\/g, '/') + '/.claude/coter-brain'
  }
  const journal = dir.replace(/\/+$/, '') + '/journal'
  const entries = new Map()
  const ops = []
  for (const device of await listDir($, journal)) {
    if (device.kind !== 'dir') continue
    for (const f of await listDir($, journal + '/' + device.name)) {
      if (!f.name.endsWith('.jsonl')) continue
      for (const line of (await readText($, journal + '/' + device.name + '/' + f.name)).split('\n')) {
        const row = safeJson(line)
        if (!row) continue
        if (row.op) ops.push(row)
        else if (row.id && row.kind) entries.set(row.id, row)
      }
    }
  }
  ops.sort((a, b) => a.at - b.at)
  for (const op of ops) {
    const e = entries.get(op.ref)
    if (e && op.op === 'status') entries.set(op.ref, { ...e, status: op.status, updatedAt: op.at })
  }
  const now = await $.clock.now()
  const by = {}
  for (const e of entries.values()) {
    if (e.kind !== 'waiting' || e.status !== 'active' || now - (e.updatedAt || e.at) > WAITING_TTL_MS) continue
    const p = e.project || 'every project'
    by[p] = (by[p] || 0) + 1
  }
  return by
}

// Sends the counts when they change (the bridge keeps the newest for pages that connect later)
async function sendWaiting($, force) {
  const by = await readWaiting($)
  const key = JSON.stringify(by)
  if (key === lastWaiting && !force) return
  lastWaiting = key
  emit($, 'waiting', { projects: by, count: Object.values(by).reduce((a, b) => a + b, 0) })
}

async function healthy($) {
  try {
    const r = await $.http.fetch(base + '/health')
    return r.ok && r.text.includes('"undertone"')
  } catch {
    return false
  }
}

async function ensureBridge($) {
  if (await healthy($)) return true
  const child = $.process.spawn({ argv: ['node', $.plugin.root + '/bridge/server.mjs', String(port)] })
  bridge = child
  // The loop is the child's life: it ends with the bridge or when this module unloads
  void (async () => {
    try {
      for await (const piece of child) {
        const text = String(piece.text || '').trim()
        if (text) $.ui.log('undertone bridge: ' + text, { to: 'debug' })
      }
    } catch (err) {
      $.ui.log('undertone: the bridge did not start: ' + (err && err.message ? err.message : err))
    }
    if (bridge === child) bridge = null
  })()
  for (let i = 0; i < 20; i++) {
    await $.clock.sleep(150)
    if (await healthy($)) {
      downUntil = 0
      return true
    }
  }
  return false
}

async function openPage($) {
  const url = base + '/'
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const tries = windows ? [['cmd', '/c', 'start', '', url]] : [['open', url], ['xdg-open', url]]
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 5000 })
      if (r.exitCode === 0) return true
    } catch {}
  }
  return false
}

export function register(on, options) {
  port = Number(options && options.port) || DEFAULT_PORT
  base = 'http://127.0.0.1:' + port
  brainDir = String((options && options.brainDir) || '').replace(/\\/g, '/')

  on('session.start', async ($, e, next) => {
    lane = laneFor(await $.session.root(), await $.session.id())
    try {
      await $.command.register({ name: 'undertone', description: 'Play this session as music: start the bridge and open the page', argumentHint: '[status|off|on|stop]' })
    } catch (err) {
      $.ui.log('undertone: could not add /undertone: ' + (err && err.message ? err.message : err))
    }
    emit($, 'session.start')
    // A heartbeat, so a session that closes without saying goodbye leaves the page within minutes
    $.clock.every(HEARTBEAT_MS, () => emit($, 'alive'))
    $.clock.after(1500, () => sendWaiting($, true))
    $.clock.every(WAITING_EVERY_MS, () => sendWaiting($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    emit($, 'session.end')
    await flush($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    emit($, 'prompt')
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    emit($, 'turn.start')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) emit($, 'turn.end')
    return next(e)
  })

  // Claude Code asking for you: a permission prompt, or idle and waiting for input
  on('classic.Notification', async ($, e, next) => {
    const kind = String(e.notification_type || '') + ' ' + String(e.message || '')
    const reason = /permission|elicitation|approve/i.test(kind) ? 'permission' : /idle|waiting for your input/i.test(kind) ? 'idle' : null
    if (reason) emit($, 'attention', { reason })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // coter-kit's own tools answer without calling next, so read them on the way in
    if (e.tool === CHECKLIST_TOOL && Array.isArray(e.items)) {
      emit($, 'checklist', { done: e.items.filter((it) => it && it.status === 'done').length, total: e.items.length })
    }
    if (e.tool === REMEMBER_TOOL && Array.isArray(e.notes)) {
      for (const n of e.notes) {
        if (n && n.kind === 'waiting') emit($, 'waiting.open')
        else if (n && n.kind === 'decision' && n.resolves) emit($, 'waiting.resolve')
      }
      // coter-kit writes the note after this call; read the new counts once it has
      $.clock.after(2000, () => sendWaiting($))
    }

    const result = await next(e)
    if (!result || result.deny) return result

    emit($, 'tool', { tool: shortTool(e.tool), kind: kindOf(e.tool) })
    if (e.tool === 'Bash' && typeof e.command === 'string') {
      const cmd = e.command
      if (!result.isError && COMMIT_CMD.test(cmd)) emit($, 'commit')
      if (!result.isError && PUSH_CMD.test(cmd)) emit($, 'push')
      if (CHECK_CMD.test(cmd)) emit($, result.isError ? 'fail' : 'pass', { source: 'command' })
    }
    return result
  })

  // coter-kit's checks block the stop when they fail; a clean stop after that means they pass
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result && result.block) {
      checksFailing = true
      emit($, 'fail', { source: 'checks' })
    } else if (checksFailing) {
      checksFailing = false
      emit($, 'pass', { source: 'checks' })
    }
    return result
  })

  on('command.run', { command: 'undertone' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()

    if (arg === 'off') {
      emit($, 'session.end')
      await flush($)
      sending = false
      return { text: 'undertone: this session stopped sending events. `/undertone on` brings it back.' }
    }
    if (arg === 'on') {
      sending = true
      downUntil = 0
      emit($, 'session.start')
      return { text: 'undertone: this session is sending events again.' }
    }
    if (arg === 'status') {
      const up = await healthy($)
      return {
        text: 'undertone: bridge ' + (up ? 'running at ' + base : 'not running') +
          '; this session (' + (lane ? lane.label : '?') + ') is ' + (sending ? 'sending' : 'not sending') + ' events.',
      }
    }
    if (arg === 'stop') {
      if (!bridge) return { text: 'undertone: this session did not start the bridge, so it is left running. Stop it where it was started.' }
      const child = bridge
      bridge = null
      try { await child.return(undefined) } catch {}
      return { text: 'undertone: bridge stopped.' }
    }

    if (!(await ensureBridge($))) {
      return { text: 'undertone: the bridge did not start. Run `npm start` in ' + $.plugin.root + ' to see why.' }
    }
    downUntil = 0
    const opened = await openPage($)
    emit($, 'session.start')
    return {
      text: 'undertone is running at ' + base + (opened ? ' (opened in your browser)' : '') +
        '. Press Play on the page. This session plays as "' + (lane ? lane.label : 'session') + '".',
    }
  })
}
