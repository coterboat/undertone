import { expect, mock, test } from 'claude-code/testing'

type Opts = { root?: string; up?: boolean; stopBlocks?: () => boolean; brain?: Record<string, string>; git?: string; stopped?: boolean; os?: string; oldBridge?: boolean }
const MANUAL = { options: { bridge: 'manual' } }

// Stubs for everything undertone asks Claude Code for. The bridge is a flag: `up`
// answers /health, and every POST to /event is recorded as the batch it carried. Starting it
// (node bridge/launch.mjs) is recorded in `spawned`; `stopped` is the /undertone stop marker.
function stubAll(on: any, opts: Opts = {}) {
  const posted: any[] = []
  const ran: string[][] = []
  const spawned: string[][] = []
  const state = { up: opts.up ?? true, fetches: 0, sessionId: 'a1b2c3d4-e5f6', registered: 0, brainReads: 0, stopped: opts.stopped ?? false, shutdowns: [] as any[] }
  const clock = mock.clock(on, { now: Date.now() })

  on('env.get', ($: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : e.name === 'OS' ? opts.os : undefined }))
  // coter-kit's brain, as journal files under /home/me/.claude/coter-brain/journal/<device>/
  const brain = opts.brain ?? {}
  const JOURNAL = '/home/me/.claude/coter-brain/journal'
  on('fs.list', ($: any, e: any) => {
    const dir = String(e.path).replace(/\\/g, '/').replace(/\/$/, '')
    if (dir === JOURNAL) state.brainReads += 1
    if (dir === '/home/me/.undertone') return { value: state.stopped ? [{ name: 'stopped', kind: 'file', size: 25, mtimeMs: 0, isLink: false }] : [] }
    const kids = new Map<string, string>()
    for (const file of Object.keys(brain)) {
      const full = JOURNAL + '/' + file
      if (!full.startsWith(dir + '/')) continue
      const rest = full.slice(dir.length + 1)
      kids.set(rest.split('/')[0], rest.includes('/') ? 'dir' : 'file')
    }
    return { value: [...kids].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', ($: any, e: any) => {
    const file = String(e.path).replace(/\\/g, '/').slice(JOURNAL.length + 1)
    return brain[file] != null ? { value: brain[file] } : { deny: 'no such file' }
  })
  on('session.root', () => ({ value: opts.root ?? '/work/jobsnearme' }))
  on('session.id', () => ({ value: state.sessionId }))
  on('session.start', () => ({ cwd: opts.root ?? '/work/jobsnearme' }))
  on('session.end', () => ({}))
  on('command.register', () => { state.registered += 1; return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  on('http.fetch', ($: any, e: any) => {
    state.fetches += 1
    if (!state.up) return { deny: 'connect ECONNREFUSED 127.0.0.1:4747' }
    if (e.url.endsWith('/health')) return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true,"name":"undertone"}' } }
    if (e.url.endsWith('/event')) posted.push(...JSON.parse(e.init.body))
    // A bridge from before 0.6 has no /shutdown
    if (e.url.endsWith('/shutdown') && opts.oldBridge) return { value: { status: 404, ok: false, headers: {}, text: 'not found' } }
    if (e.url.endsWith('/shutdown')) {
      state.shutdowns.push(JSON.parse(e.init.body))
      state.up = false
      if (JSON.parse(e.init.body).sticky) state.stopped = true
      return { value: { status: 202, ok: true, headers: {}, text: '{"ok":true}' } }
    }
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('process.run', ($: any, e: any) => {
    ran.push([...e.argv])
    // `git rev-parse --show-toplevel --git-common-dir`: opts.git is its output; otherwise not a repo
    if (e.argv[0] === 'git' && e.argv[1] === 'rev-parse') return { value: opts.git ? { exitCode: 0, stdout: opts.git, stderr: '' } : { exitCode: 128, stdout: '', stderr: 'not a git repository' } }
    // The launcher: the bridge comes up unless it was stopped on purpose and this isn't --resume
    if (e.argv[0] === 'node' && /\/bridge\/launch\.mjs$/.test(String(e.argv[1]).replace(/\\/g, '/'))) {
      spawned.push([...e.argv])
      if (e.argv.includes('--resume')) state.stopped = false
      if (!state.stopped) state.up = true
      return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  // The bridge never runs as a child of the session any more
  on('process.spawn', async function* ($: any, e: any) {
    spawned.push(['spawn', ...e.argv])
    return { code: 1, signal: null }
  })
  on('classic.Stop', () => (opts.stopBlocks && opts.stopBlocks() ? { block: 'Automatic checks failed' } : {}))
  on('classic.Notification', () => ({}))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // A Bash command containing "FAIL" exits non-zero, like a failing test run
  on('tool.call', ($: any, e: any) => (e.tool === 'Bash' && /FAIL/.test(e.command) ? { result: 'exit 1', isError: true } : { result: 'ok' }))
  return { posted, ran, spawned, state, clock }
}

async function start($: any, clock: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(200)
}

const types = (posted: any[]) => posted.map((e) => e.type)

test('a session plays as its project, and a worktree as project · worktree', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on, { root: '/Users/me/GitHub/jobsnearme/.claude/worktrees/oct2-signup' })
  await start($, clock)
  expect(posted[0]).toMatchObject({ type: 'session.start', lane: 'a1b2c3d4', project: 'jobsnearme', label: 'jobsnearme · oct2-signup' })
})

test('prompts, turns and tool calls reach the page, without prompt text or commands', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.prompt.submit({ text: 'secret plans for FS-304', wait: false, origin: { kind: 'user' } })
  await $.tool.call({ tool: 'Read', file_path: '/work/jobsnearme/src/app.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/jobsnearme/src/app.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'mcp__claude-in-chrome__navigate', url: 'https://example.com' })
  await clock.advance(200)
  expect(types(posted)).toEqual(['session.start', 'prompt', 'tool', 'tool', 'tool'])
  expect(posted.slice(2).map((e) => [e.tool, e.kind])).toEqual([['Read', 'read'], ['Edit', 'edit'], ['navigate', 'web']])
  const wire = JSON.stringify(posted)
  expect(wire).not.toContain('secret plans')
  expect(wire).not.toContain('/work/jobsnearme/src')
  expect(wire).not.toContain('claude-in-chrome')
})

test('a commit lands, a failing check breaks the build, and the same check passing fixes it', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "FS-304 layout B"' })
  await $.tool.call({ tool: 'Bash', command: 'npm run typecheck # FAIL' })
  await $.tool.call({ tool: 'Bash', command: 'grep -rn FAIL src' })
  await $.tool.call({ tool: 'Bash', command: 'npm run typecheck' })
  await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  await clock.advance(200)
  const story = types(posted).filter((t) => t !== 'tool')
  expect(story).toEqual(['session.start', 'commit', 'fail', 'pass', 'push'])
  expect(JSON.stringify(posted)).not.toContain('FS-304 layout B')
})

test("coter-kit's checklist and waiting notes are read on the way in", async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.tool.call({ tool: 'mcp__coter-kit__checklist', items: [{ text: 'a', status: 'done' }, { text: 'b', status: 'done' }, { text: 'c', status: 'active' }] })
  await $.tool.call({ tool: 'mcp__coter-kit__remember', notes: [{ kind: 'waiting', text: 'Q23 sign FS-321', ref: 'Q23', link: 'https://claude.ai/artifact/x' }] })
  await $.tool.call({ tool: 'mcp__coter-kit__remember', notes: [{ kind: 'decision', text: 'Q23 signed', resolves: 'w1' }, { kind: 'fact', text: 'unrelated' }] })
  await clock.advance(200)
  const story = posted.filter((e) => e.type !== 'tool')
  expect(story.map((e) => e.type)).toEqual(['session.start', 'checklist', 'waiting.open', 'waiting.resolve'])
  expect(story[1]).toMatchObject({ done: 2, total: 3 })
})

test("coter-kit's checks blocking a stop break the build; the next clean stop fixes it", async ($: any, on: any) => {
  let block = true
  const { posted, clock } = stubAll(on, { stopBlocks: () => block })
  await start($, clock)
  await $.classic.Stop({})
  block = false
  await $.classic.Stop({})
  await $.classic.Stop({})
  await clock.advance(200)
  expect(posted.filter((e) => e.type === 'fail' || e.type === 'pass').map((e) => [e.type, e.source])).toEqual([['fail', 'checks'], ['pass', 'checks']])
})

test('/undertone starts the bridge when it is down, detached and lifting a stop, then opens the page', MANUAL, async ($: any, on: any) => {
  const { spawned, ran, clock, posted } = stubAll(on, { up: false, stopped: true })
  await start($, clock)
  expect(spawned).toHaveLength(0)
  const pending = $.command.run({ command: 'undertone', args: '' })
  await clock.advance(400)
  const out: any = await pending
  expect(spawned).toHaveLength(1)
  expect(spawned[0][0]).toBe('node')
  expect(spawned[0][1].replace(/\\/g, '/')).toMatch(/\/bridge\/launch\.mjs$/)
  expect(spawned[0].slice(2)).toEqual(['4747', '--auto', '--resume'])
  expect(ran).toContainEqual(['open', 'http://127.0.0.1:4747/'])
  expect(out.text).toContain('running at http://127.0.0.1:4747')
  await clock.advance(200)
  expect(types(posted)).toContain('session.start')
})

test('/undertone with the bridge already up does not start another', async ($: any, on: any) => {
  const { spawned, clock } = stubAll(on, { up: true })
  await start($, clock)
  const out: any = await $.command.run({ command: 'undertone', args: '' })
  expect(spawned).toHaveLength(0)
  expect(out.text).toContain('running at')
})

test('/undertone off stops sending until /undertone on', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.command.run({ command: 'undertone', args: 'off' })
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await clock.advance(200)
  expect(types(posted)).toEqual(['session.start', 'session.end'])
  await $.command.run({ command: 'undertone', args: 'on' })
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await clock.advance(200)
  expect(types(posted).slice(2)).toEqual(['session.start', 'tool'])
})

test('with the bridge set to manual and none seen, events wait, it retries every 15 seconds, and it never starts one', MANUAL, async ($: any, on: any) => {
  // Changed in 0.3: events are kept (500, 5 minutes) instead of dropped, and resent in order
  const { state, clock, spawned, posted } = stubAll(on, { up: false })
  await start($, clock)
  const afterFirst = state.fetches
  expect(afterFirst).toBe(1)
  for (let i = 0; i < 5; i++) {
    await $.tool.call({ tool: 'Read', file_path: '/x' })
    await clock.advance(200)
  }
  expect(state.fetches).toBe(afterFirst)
  await clock.advance(15_000)
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await clock.advance(200)
  expect(state.fetches).toBe(afterFirst + 1)
  expect(spawned).toHaveLength(0)
  // Once a bridge answers, everything that waited arrives in order
  state.up = true
  await clock.advance(15_000)
  await $.tool.call({ tool: 'Edit', file_path: '/x', old_string: 'a', new_string: 'b' })
  await clock.advance(200)
  expect(types(posted)).toEqual(['session.start', 'tool', 'tool', 'tool', 'tool', 'tool', 'waiting', 'tool', 'tool'])
  expect(posted[posted.length - 1].tool).toBe('Edit')
})

test('a session sends a heartbeat every minute, so a closed one leaves the page', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await clock.advance(60_200)
  await clock.advance(60_200)
  expect(types(posted).filter((t) => t === 'alive')).toHaveLength(2)
})

test('a permission prompt or an idle wait becomes a call for you, without its text', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  await $.classic.Notification({ message: 'Signed in', notification_type: 'auth_success' })
  await clock.advance(200)
  expect(posted.filter((e) => e.type === 'attention').map((e) => e.reason)).toEqual(['permission', 'idle'])
  expect(JSON.stringify(posted)).not.toContain('Claude needs your permission')
})

test("the drone hears coter-kit's open questions per project, answered and expired ones left out", async ($: any, on: any) => {
  const now = Date.now()
  const row = (o: any) => JSON.stringify(o)
  const brain = {
    'pc/2026-10-02-a.jsonl': [
      row({ id: 'q1', at: now - 3_600_000, project: 'jobsnearme', kind: 'waiting', text: 'Q15 302 ok', status: 'active' }),
      row({ id: 'q2', at: now - 3_600_000, project: 'jobsnearme', kind: 'waiting', text: 'Q16 sign FS-310', status: 'active' }),
      row({ id: 'q3', at: now - 3_600_000, project: 'coter-kit', kind: 'waiting', text: 'pick the fixes', status: 'active' }),
      row({ id: 'q4', at: now - 40 * 86_400_000, project: 'ourplace', kind: 'waiting', text: 'too old', status: 'active' }),
      row({ id: 'f1', at: now, project: 'jobsnearme', kind: 'fact', text: 'not a question', status: 'active' }),
    ].join('\n'),
    'mac/2026-10-03-b.jsonl': row({ op: 'status', ref: 'q2', status: 'superseded', at: now - 60_000 }),
  }
  const { posted, clock } = stubAll(on, { brain })
  await start($, clock)
  await clock.advance(1_800)
  const waiting = posted.filter((e) => e.type === 'waiting')
  expect(waiting).toHaveLength(1)
  expect(waiting[0]).toMatchObject({ projects: { jobsnearme: 1, 'coter-kit': 1 }, count: 2 })
  expect(JSON.stringify(posted)).not.toContain('Q15')
  // Unchanged counts aren't sent again
  await clock.advance(120_500)
  expect(posted.filter((e) => e.type === 'waiting')).toHaveLength(1)
})

test('session.start on resume, clear and compaction sets up one heartbeat, one command, and one brain read per start', async ($: any, on: any) => {
  const { posted, clock, state } = stubAll(on)
  for (let i = 0; i < 4; i++) await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(180_500)
  expect(types(posted).filter((t) => t === 'alive')).toHaveLength(3)
  expect(state.registered).toBe(1)
  // four reads, one per start, plus one from the two-minute check; not one per start per interval
  expect(state.brainReads).toBe(5)
})

test('a new session id ends the old lane before the new one starts', async ($: any, on: any) => {
  const { posted, clock, state } = stubAll(on)
  await start($, clock)
  state.sessionId = 'b2c3d4e5-f6a7'
  await start($, clock)
  expect(posted.map((e) => e.type + ':' + e.lane)).toEqual(['session.start:a1b2c3d4', 'session.end:a1b2c3d4', 'session.start:b2c3d4e5'])
})

test('a failing npm test then a passing lint leaves tests failing; a passing npm test clears them', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.tool.call({ tool: 'Bash', command: 'npm test # FAIL' })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(200)
  const checks = posted.filter((e) => e.type === 'fail' || e.type === 'pass').map((e) => e.type + ':' + e.check)
  expect(checks).toEqual(['fail:test', 'pass:lint', 'pass:test'])
})

test('a scheduled run is marked from its first prompt, and neither the prompt nor the task name leaves', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on)
  await start($, clock)
  await $.prompt.submit({ text: '<scheduled-task name="concurrent-bots-loop" file="/x/SKILL.md">\nThis is an automated run', wait: false, origin: { kind: 'user' } })
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await clock.advance(200)
  expect(posted.filter((e) => e.type !== 'session.start').every((e) => e.scheduled === true)).toBe(true)
  const wire = JSON.stringify(posted)
  expect(wire).not.toContain('concurrent-bots-loop')
  expect(wire).not.toContain('scheduled-task')
})

test('a bridge that was running is started again once when it stops answering, and what waited arrives in order', async ($: any, on: any) => {
  const { posted, clock, spawned, state } = stubAll(on, { up: true })
  await start($, clock)
  state.up = false
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await clock.advance(200)
  await clock.advance(3_500) // ensureBridge waits on its health checks
  expect(spawned).toHaveLength(1)
  state.up = false // it died again straight away
  await clock.advance(15_000)
  await $.tool.call({ tool: 'Read', file_path: '/b' })
  await clock.advance(3_700)
  expect(spawned).toHaveLength(1) // not again within a minute
  state.up = true
  await clock.advance(15_000)
  await $.tool.call({ tool: 'Edit', file_path: '/c', old_string: 'a', new_string: 'b' })
  await clock.advance(200)
  expect(posted.filter((e) => e.type === 'tool').map((e) => e.tool)).toEqual(['Read', 'Read', 'Edit'])
})

test('/undertone stop shuts the bridge down for good: no session starts it again until /undertone', async ($: any, on: any) => {
  const { clock, spawned, state } = stubAll(on, { up: true })
  await start($, clock)
  const out: any = await $.command.run({ command: 'undertone', args: 'stop' })
  expect(state.shutdowns).toEqual([{ sticky: true }])
  expect(state.up).toBe(false)
  expect(out.text).toContain('bridge stopped')
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await clock.advance(5_000)
  expect(spawned).toHaveLength(0)
})

test('/undertone stop on a bridge older than 0.6 says it did not stop, instead of claiming it did', async ($: any, on: any) => {
  const { clock, state } = stubAll(on, { up: true, oldBridge: true })
  await start($, clock)
  const out: any = await $.command.run({ command: 'undertone', args: 'stop' })
  expect(out.text).toContain('did not stop')
  expect(state.up).toBe(true)
})

test('a new session leaves a bridge stopped on purpose alone, and /undertone brings it back', async ($: any, on: any) => {
  const { clock, spawned, state, posted } = stubAll(on, { up: false, stopped: true })
  await start($, clock)
  await clock.advance(3_500)
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    await clock.advance(61_000)
  }
  expect(spawned).toHaveLength(0)
  const pending = $.command.run({ command: 'undertone', args: '' })
  await clock.advance(400)
  await pending
  expect(spawned).toHaveLength(1)
  expect(state.stopped).toBe(false)
  await clock.advance(200)
  expect(types(posted).filter((t) => t === 'tool')).toHaveLength(3)
})

test('the first session starts the bridge on its own, detached, and what it said first arrives', async ($: any, on: any) => {
  const { clock, spawned, posted } = stubAll(on, { up: false })
  await start($, clock)
  await clock.advance(3_500)
  expect(spawned).toHaveLength(1)
  expect(spawned[0].slice(2)).toEqual(['4747', '--auto'])
  await clock.advance(200)
  expect(types(posted)[0]).toBe('session.start')
  // A second session start (resume, clear) with the bridge up starts nothing
  await start($, clock)
  await clock.advance(3_500)
  expect(spawned).toHaveLength(1)
})

test('on Windows the same launcher starts it, with no shell or PowerShell in between', async ($: any, on: any) => {
  const { clock, spawned } = stubAll(on, { up: false, os: 'Windows_NT' })
  await start($, clock)
  await clock.advance(3_500)
  expect(spawned).toHaveLength(1)
  expect(spawned[0][0]).toBe('node')
  expect(spawned[0][1].replace(/\\/g, '/')).toMatch(/\/bridge\/launch\.mjs$/)
})

test('with the bridge set to manual, sessions never start it', MANUAL, async ($: any, on: any) => {
  const { clock, spawned, state } = stubAll(on, { up: false })
  await start($, clock)
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    await clock.advance(61_000)
  }
  expect(spawned).toHaveLength(0)
  expect(state.fetches).toBeGreaterThan(0)
})

test('a sibling git worktree plays as its main checkout · the worktree folder', async ($: any, on: any) => {
  const { posted, clock } = stubAll(on, { root: '/Users/me/GitHub/EO7-sprites', git: '/Users/me/GitHub/EO7-sprites\n/Users/me/GitHub/EO7/.git\n' })
  await start($, clock)
  expect(posted[0]).toMatchObject({ project: 'EO7', label: 'EO7 · EO7-sprites' })
})
