import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventsForRuns, makeGithubSource, ciCheck, githubLane } from '../../sources/github-actions.mjs'

const lane = githubLane('jobsnearme-ci', { github: 'coterboat/jobsnearme', project: 'jobsnearme', label: 'jobsnearme CI' })
const CI = 337473767
const PAGES = 247486111
const run = (id, workflow_id, name, status, conclusion = null) => ({ id, workflow_id, name, status, conclusion })
// The bridge's own pattern for a check (bridge/server.mjs)
const CHECK = /^[a-z][a-z0-9_-]{0,20}(:[A-Za-z0-9_.-]{1,24})?$/

test('the first look sets the scene: a workflow red right now fails, history plays nothing', () => {
  const memo = {}
  const runs = [
    run(5, PAGES, 'Deploy to GitHub Pages', 'completed', 'success'),
    run(4, CI, 'CI', 'completed', 'cancelled'), // superseded by a newer push: decides nothing
    run(3, CI, 'CI', 'completed', 'failure'),
    run(2, CI, 'CI', 'completed', 'success'),
  ]
  assert.deepEqual(eventsForRuns(lane, runs, memo), [{ type: 'fail', ...lane, check: 'ci:CI' }])
  assert.deepEqual(eventsForRuns(lane, runs, memo), [], 'the same runs again play nothing')
})

test('builds starting play as notes, a green finish as a chime and clears its check, once each', () => {
  const memo = {}
  const old = [run(3, CI, 'CI', 'completed', 'failure'), run(2, PAGES, 'Deploy to GitHub Pages', 'completed', 'success')]
  eventsForRuns(lane, old, memo)
  const started = [run(7, CI, 'CI', 'in_progress'), run(6, PAGES, 'Deploy to GitHub Pages', 'queued'), ...old]
  assert.deepEqual(eventsForRuns(lane, started, memo), [{ type: 'pulse', ...lane, count: 2, what: 'builds started', kind: 'run' }])
  const finished = [run(7, CI, 'CI', 'completed', 'success'), run(6, PAGES, 'Deploy to GitHub Pages', 'completed', 'failure'), ...old]
  assert.deepEqual(eventsForRuns(lane, finished, memo), [
    { type: 'pulse', ...lane, count: 1, what: 'builds passed', kind: 'chime' },
    { type: 'pass', ...lane, check: 'ci:CI' },
    { type: 'fail', ...lane, check: 'ci:Deploy-to-GitHub-Pages' },
  ])
  assert.deepEqual(eventsForRuns(lane, finished, memo), [])
})

test('check names fit the bridge, and only names, outcomes and counts leave', () => {
  for (const name of ['CI', 'Deploy to GitHub Pages', 'Azure Static Web Apps CI/CD', 'Android release', '', '日本語 only']) {
    assert.match(ciCheck(name), CHECK, name)
  }
  assert.equal(ciCheck('Azure Static Web Apps CI/CD'), 'ci:Azure-Static-Web-Apps-CI') // 24 characters at most
  const memo = {}
  const leaky = { ...run(9, CI, 'CI', 'completed', 'failure'), head_branch: 'FS-321-consent', head_commit: { message: 'secret plans' }, actor: { login: 'someone' } }
  const wire = JSON.stringify(eventsForRuns(lane, [leaky], memo))
  for (const s of ['FS-321', 'secret plans', 'someone']) assert.ok(!wire.includes(s), s)
})

test('the source asks gh for the default branch once, then the runs on it, and says what went wrong', async () => {
  const calls = []
  const sent = []
  const logged = []
  const gh = async (args) => {
    calls.push(args)
    if (args[1] === 'repos/coterboat/jobsnearme') return { default_branch: 'main' }
    return { workflow_runs: [{ ...run(3, CI, 'CI', 'completed', 'failure'), head_commit: { message: 'x' } }] }
  }
  const src = makeGithubSource('jobsnearme-ci', { github: 'coterboat/jobsnearme', project: 'jobsnearme' }, { gh, send: async (e) => sent.push(...e), log: (m) => logged.push(m) })
  assert.equal(await src.tick(), true)
  assert.equal(await src.tick(), true)
  assert.deepEqual(calls.map((a) => a[1]), ['repos/coterboat/jobsnearme', 'repos/coterboat/jobsnearme/actions/runs?branch=main&per_page=30', 'repos/coterboat/jobsnearme/actions/runs?branch=main&per_page=30'])
  assert.deepEqual(sent.map((e) => e.type + ':' + e.check), ['fail:ci:CI'])
  assert.equal(sent[0].origin, 'github')

  const bad = makeGithubSource('x', { github: 'not a repo; rm -rf' }, { gh: async () => { throw new Error('must not run') }, log: (m) => logged.push(m) })
  assert.equal(await bad.tick(), false)
  assert.match(logged.at(-1), /should be owner\/repo/)

  const down = makeGithubSource('y', { github: 'a/b', branch: 'main' }, { gh: async () => { throw new Error('HTTP 401: Bad credentials') }, log: (m) => logged.push(m) })
  assert.equal(await down.tick(), false)
  assert.match(logged.at(-1), /undertone y: HTTP 401/)
})
