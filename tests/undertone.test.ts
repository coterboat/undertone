import { expect, mock, test } from 'claude-code/testing'

type Opts = { root?: string; up?: boolean; stopBlocks?: () => boolean }

// Stubs for everything undertone asks Claude Code for. The bridge is a flag: `up`
// answers /health, and every POST to /event is recorded as the batch it carried.
function stubAll(on: any, opts: Opts = {}) {
  const posted: any[] = []
  const ran: string[][] = []
  const spawned: string[][] = []
  const state = { up: opts.up ?? true, fetches: 0 }
  const clock = mock.clock(on, { now: Date.now() })

  on('env.get', () => ({ value: undefined }))
  on('session.root', () => ({ value: opts.root ?? '/work/jobsnearme' }))
  on('session.id', () => ({ value: 'a1b2c3d4-e5f6' }))
  on('session.start', () => ({ cwd: opts.root ?? '/work/jobsnearme' }))
  on('session.end', () => ({}))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('http.fetch', ($: any, e: any) => {
    state.fetches += 1
    if (!state.up) return { deny: 'connect ECONNREFUSED 127.0.0.1:4747' }
    if (e.url.endsWith('/health')) return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true,"name":"undertone"}' } }
    if (e.url.endsWith('/event')) posted.push(...JSON.parse(e.init.body))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('process.run', ($: any, e: any) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('process.spawn', async function* ($: any, e: any) {
    spawned.push([...e.argv])
    state.up = true
    yield { stream: 'stdout', text: 'undertone bridge on http://127.0.0.1:4747' }
    return { code: 0, signal: null }
  })
  on('classic.Stop', () => (opts.stopBlocks && opts.stopBlocks() ? { block: 'Automatic checks failed' } : {}))
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

test('/undertone starts the bridge when it is down, then opens the page', async ($: any, on: any) => {
  const { spawned, ran, clock, posted } = stubAll(on, { up: false })
  await start($, clock)
  const pending = $.command.run({ command: 'undertone', args: '' })
  await clock.advance(400)
  const out: any = await pending
  expect(spawned).toHaveLength(1)
  expect(spawned[0][0]).toBe('node')
  expect(spawned[0][1].replace(/\\/g, '/')).toMatch(/\/bridge\/server\.mjs$/)
  expect(spawned[0][2]).toBe('4747')
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

test('with no bridge running, events are dropped and it only retries every 15 seconds', async ($: any, on: any) => {
  const { state, clock } = stubAll(on, { up: false })
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
})
