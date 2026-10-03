// undertone: plays your Claude Code sessions as music.
//
// This mod sends what the session does (turns, tool calls, edits, commits, which checks fail and
// pass, permission prompts, coter-kit's checklist) to the undertone bridge on 127.0.0.1, which
// streams it to the page in your browser, along with how many coter-kit questions wait on you in
// each project. Only event types, tool names, check names (test, typecheck, lint, build), project
// names, counts and a scheduled-run flag leave the session: never prompt text, file paths or commands.
//
//   /undertone          start the bridge if it isn't running and open the page
//   /undertone status   is the bridge up, and is this session sending
//   /undertone off|on   stop or resume sending this session's events
//   /undertone stop     stop the bridge; sessions won't start it again until /undertone or npm start
//
// The bridge is simply there: the first session starts it detached (it belongs to no session) and
// it leaves on its own after a quiet hour. The `bridge` setting "manual" turns that off.

import { analyzeCommand, outcomes } from './commands.js'
import { countWaiting } from './waiting.js'

const DEFAULT_PORT = 4747
const CHECKLIST_TOOL = 'mcp__coter-kit__checklist'
const REMEMBER_TOOL = 'mcp__coter-kit__remember'
const DOWN_BACKOFF_MS = 15_000
const HEARTBEAT_MS = 60_000
const WAITING_EVERY_MS = 120_000
// While the bridge is down, events wait (heartbeats don't): at most this many, this long
const HOLD_MAX = 500
const HOLD_MS = 5 * 60_000
// A bridge seen this recently that stops answering is started again, at most once a minute
const RESTART_IF_SEEN_MS = 30 * 60_000
const RESTART_EVERY_MS = 60_000

let port = DEFAULT_PORT
let base = 'http://127.0.0.1:' + DEFAULT_PORT
let lane = null // { lane, project, label }
let sending = true
let queue = [] // { e, at } — at is stamped by the first flush that tries to send it
let flushTimer = null
let downUntil = 0
let lastHealthy = 0
let lastRestartTry = 0
let autoRestart = true
let bridgeMode = 'auto' // auto: the first session starts the bridge; manual: only /undertone or npm start
let checksFailing = false
let brainDir = ''
let lastWaiting = ''
let started = false // timers and the command are set up once per module load
let scheduled = false // this session is a scheduled run: it plays quietly and never calls you
let promptSeen = false

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

// From the path alone: a worktree under .claude/worktrees/<name> plays as "<project> · <name>"
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

// From git, when it answers: any linked worktree (a sibling folder such as ~/GitHub/EO7-sprites
// too) plays as "<main checkout> · <worktree folder>"
const leaf = (p) => p.replace(/\/+$/, '').split('/').pop()
async function gitNames($, root) {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--git-common-dir'], { cwd: root, timeoutMs: 3000 })
    if (r.exitCode !== 0) return null
    const [top, common] = String(r.stdout || '').trim().split('\n').map((s) => s.trim().replace(/\\/g, '/'))
    if (!top || !common) return null
    const commonAbs = /^(\/|[A-Za-z]:\/)/.test(common) ? common : top.replace(/\/+$/, '') + '/' + common
    const main = commonAbs.replace(/\/+$/, '').replace(/\/\.git$/, '')
    if (main === commonAbs.replace(/\/+$/, '')) return null // a bare or unusual layout: trust the path
    const project = leaf(main)
    return { project, label: main === top.replace(/\/+$/, '') ? project : project + ' · ' + leaf(top) }
  } catch {
    return null
  }
}

async function laneNow($) {
  const root = await $.session.root()
  const fromPath = laneFor(root, await $.session.id())
  const fromGit = await gitNames($, root)
  return fromGit ? { ...fromPath, ...fromGit } : fromPath
}

function enqueue($, e) {
  queue.push({ e, at: null })
  if (!flushTimer) flushTimer = $.clock.after(120, () => { flushTimer = null; return flush($) })
}

function emit($, type, extra) {
  if (!lane || !sending) return
  enqueue($, { type, ...lane, ...(scheduled ? { scheduled: true } : {}), ...extra })
}

// Batches go out about every 120 ms. While the bridge is down they wait (500 events, 5 minutes)
// and go out in order once it's back; a bridge that was running is started again.
async function flush($) {
  if (!queue.length) return
  const now = await $.clock.now()
  for (const q of queue) if (q.at == null) q.at = now
  queue = queue.filter((q) => now - q.at <= HOLD_MS)
  if (queue.length > HOLD_MAX) queue.splice(0, queue.length - HOLD_MAX)
  if (now < downUntil) return
  const batch = queue
  queue = []
  try {
    const r = await $.http.fetch(base + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch.map((q) => q.e)) })
    if (!r.ok) throw new Error('bridge answered ' + r.status)
    lastHealthy = now
    downUntil = 0
  } catch {
    downUntil = now + DOWN_BACKOFF_MS
    queue = batch.filter((q) => q.e.type !== 'alive').concat(queue)
    if (autoRestart && (bridgeMode === 'auto' || (lastHealthy && now - lastHealthy < RESTART_IF_SEEN_MS)) && now - lastRestartTry >= RESTART_EVERY_MS) {
      lastRestartTry = now
      void ensureBridge($).then((ok) => { if (ok) flush($) })
    }
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

// Every machine's journal rows; countWaiting (hooks/waiting.js) does the counting
async function readWaiting($) {
  let dir = brainDir
  if (!dir) {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
    if (!home) return {}
    dir = String(home).replace(/\\/g, '/') + '/.claude/coter-brain'
  }
  const journal = dir.replace(/\/+$/, '') + '/journal'
  const rows = []
  for (const device of await listDir($, journal)) {
    if (device.kind !== 'dir') continue
    for (const f of await listDir($, journal + '/' + device.name)) {
      if (!f.name.endsWith('.jsonl')) continue
      for (const line of (await readText($, journal + '/' + device.name + '/' + f.name)).split('\n')) {
        const row = safeJson(line)
        if (row) rows.push(row)
      }
    }
  }
  return countWaiting(rows, await $.clock.now())
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
    const ok = r.ok && r.text.includes('"undertone"')
    if (ok) lastHealthy = await $.clock.now()
    return ok
  } catch {
    return false
  }
}

async function undertoneHome($) {
  const own = await $.env.get('UNDERTONE_HOME')
  if (own) return String(own).replace(/\\/g, '/')
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  return home ? String(home).replace(/\\/g, '/') + '/.undertone' : ''
}

// `/undertone stop` leaves this marker; sessions don't start the bridge again until `/undertone`
async function stoppedOnPurpose($) {
  const home = await undertoneHome($)
  return !!home && (await listDir($, home)).some((f) => f.name === 'stopped')
}

// Starts a bridge that belongs to no session (bridge/launch.mjs): it outlives whatever started it
// and leaves on its own after a quiet hour (--auto). `resume` lifts a deliberate /undertone stop.
async function startDetached($, resume) {
  const argv = ['node', String($.plugin.root).replace(/\\/g, '/') + '/bridge/launch.mjs', String(port), '--auto', ...(resume ? ['--resume'] : [])]
  try {
    const r = await $.process.run(argv, { timeoutMs: 15_000 })
    return r.exitCode === 0
  } catch (err) {
    $.ui.log('undertone: could not start the bridge: ' + (err && err.message ? err.message : err))
    return false
  }
}

async function ensureBridge($, resume) {
  if (await healthy($)) return true
  if (!resume && (await stoppedOnPurpose($))) return false
  if (!(await startDetached($, resume))) return false
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
  bridgeMode = options && options.bridge === 'manual' ? 'manual' : 'auto'

  // Fires on startup, /resume, /clear, compaction and /branch: the lane is refreshed every time,
  // the timers and the command are set up once
  on('session.start', async ($, e, next) => {
    const now = await laneNow($)
    if (lane && lane.lane !== now.lane) {
      if (sending) enqueue($, { type: 'session.end', ...lane, ...(scheduled ? { scheduled: true } : {}) })
      scheduled = false
      promptSeen = false
    }
    lane = now
    emit($, 'session.start')
    if (!started) {
      started = true
      try {
        await $.command.register({ name: 'undertone', description: 'Play this session as music: start the bridge and open the page', argumentHint: '[status|off|on|stop]' })
      } catch (err) {
        $.ui.log('undertone: could not add /undertone: ' + (err && err.message ? err.message : err))
      }
      // A heartbeat, so a session that closes without saying goodbye leaves the page within minutes
      $.clock.every(HEARTBEAT_MS, () => emit($, 'alive'))
      $.clock.every(WAITING_EVERY_MS, () => sendWaiting($))
    }
    $.clock.after(1500, () => sendWaiting($, true))
    // The first session starts the bridge, off the session's own startup path
    if (bridgeMode === 'auto' && sending) {
      $.clock.after(0, async () => {
        if (await healthy($)) return
        lastRestartTry = await $.clock.now()
        if (await ensureBridge($)) { downUntil = 0; await flush($) }
      })
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    emit($, 'session.end')
    await flush($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // A scheduled task's run starts with its <scheduled-task …> prompt. Only the flag leaves.
    if (!promptSeen) {
      promptSeen = true
      if (/^\s*<scheduled-task[\s>]/.test(String(e.text || ''))) scheduled = true
    }
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
    // Commits, pushes and which checks passed or failed (hooks/commands.js); never the command
    if (e.tool === 'Bash' && typeof e.command === 'string') {
      for (const o of outcomes(analyzeCommand(e.command), !result.isError)) {
        emit($, o.type, o.check ? { check: o.check, source: 'command' } : {})
      }
    }
    return result
  })

  // coter-kit's checks block the stop when they fail; a clean stop after that means they pass
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result && result.block) {
      checksFailing = true
      emit($, 'fail', { check: 'checks', source: 'checks' })
    } else if (checksFailing) {
      checksFailing = false
      emit($, 'pass', { check: 'checks', source: 'checks' })
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
          '; this session (' + (lane ? lane.label : '?') + ') is ' + (sending ? 'sending' : 'not sending') + ' events' +
          (scheduled ? ' as a scheduled run' : '') + (autoRestart ? '' : '; restarting the bridge is off') + '.',
      }
    }
    if (arg === 'stop') {
      autoRestart = false
      if (!(await healthy($))) return { text: 'undertone: no bridge is running. This session won\'t start one until `/undertone`.' }
      let r = null
      try {
        r = await $.http.fetch(base + '/shutdown', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sticky: true }) })
      } catch {}
      // A bridge from before 0.6 has no /shutdown
      if (!r || !r.ok) return { text: 'undertone: the bridge at ' + base + ' did not stop (it may be older than 0.6). Stop it where it runs (Ctrl-C, or end its process). This session won\'t restart it.' }
      return { text: 'undertone: bridge stopped. Sessions won\'t start it again until `/undertone` (or `npm start`).' }
    }

    autoRestart = true
    if (!(await ensureBridge($, true))) {
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
