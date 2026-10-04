// undertone source: GitHub Actions, played as a lane of its own.
//
// Each workflow's newest finished run on the watched branch decides its check, `ci:<workflow>`: a
// red run holds the sour note until a green one clears it. Cancelled and skipped runs decide
// nothing (a newer push cancels the older run all the time). Builds starting play as soft notes and
// a green finish as a chime, so you hear them go by. Only workflow names, outcomes and counts leave:
// never commit messages, branch names or who pushed.
//
// Needs the GitHub CLI, logged in (`gh auth login`). The bridge runs it with the other sources
// (sources/azure-metrics.mjs is the runner); an entry with "github" in ~/.config/undertone/sources.json:
//   { "jobsnearme-ci": { "github": "coterboat/jobsnearme", "project": "jobsnearme", "label": "jobsnearme CI" } }
//   branch    the branch to watch (default: the repository's default branch)
//   everySec  how often to look (default 60; GitHub allows 5,000 calls an hour)

import { execFile } from 'node:child_process'

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const BRANCH = /^[A-Za-z0-9_./-]{1,100}$/
const RED = new Set(['failure', 'timed_out', 'startup_failure'])

export const githubLane = (name, cfg) => ({ lane: 'src-' + name, project: cfg.project || name, label: cfg.label || name, origin: 'github' })

// "Deploy to GitHub Pages" -> "ci:Deploy-to-GitHub-Pages" (the bridge takes no spaces, 24 characters)
export const ciCheck = (workflow) => 'ci:' + (String(workflow || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24) || 'workflow')

// gh is gh.exe on Windows, so no shell is involved and arguments pass as they are
export function runGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('gh returned something that is not JSON')) }
    })
  })
}

// The events one look at the runs makes. Pure: `memo` carries what was already heard, so a build
// plays once and a check fails and clears exactly once. `runs` is newest first, as GitHub sends it.
// The first look only sets the scene: a workflow that is red right now fails, nothing else plays.
export function eventsForRuns(lane, runs, memo) {
  const first = !memo.seen
  if (first) Object.assign(memo, { seen: new Set(), done: new Set(), red: {} })
  let started = 0
  let green = 0
  const ids = new Set()
  for (const r of runs) {
    ids.add(r.id)
    if (!memo.seen.has(r.id)) { memo.seen.add(r.id); if (!first) started++ }
    if (r.status === 'completed' && !memo.done.has(r.id)) { memo.done.add(r.id); if (!first && r.conclusion === 'success') green++ }
  }
  // Only what's still in the window is remembered
  for (const set of [memo.seen, memo.done]) for (const id of set) if (!ids.has(id)) set.delete(id)

  const out = []
  if (started) out.push({ type: 'pulse', ...lane, count: started, what: 'builds started', kind: 'run' })
  if (green) out.push({ type: 'pulse', ...lane, count: green, what: 'builds passed', kind: 'chime' })
  const decided = new Map()
  for (const r of runs) {
    const wf = r.workflow_id ?? r.name
    if (decided.has(wf) || r.status !== 'completed') continue
    if (r.conclusion === 'success') decided.set(wf, { name: r.name, red: false })
    else if (RED.has(r.conclusion)) decided.set(wf, { name: r.name, red: true })
  }
  for (const [wf, d] of decided) {
    if (d.red && !memo.red[wf]) out.push({ type: 'fail', ...lane, check: ciCheck(d.name) })
    if (!d.red && memo.red[wf]) out.push({ type: 'pass', ...lane, check: ciCheck(d.name) })
    memo.red[wf] = d.red
  }
  return out
}

// Polls one repository. Each look waits for the last, so two can't play the same build twice.
export function makeGithubSource(name, cfg, { gh = runGh, send = async () => {}, log = console.error } = {}) {
  const lane = githubLane(name, cfg)
  const repo = String(cfg.github || '')
  const memo = {}
  let branch = cfg.branch ? String(cfg.branch) : ''
  let running = false
  const tick = async () => {
    if (running) return false
    running = true
    try {
      if (!REPO.test(repo)) throw new Error('"github" should be owner/repo, not ' + JSON.stringify(repo.slice(0, 60)))
      if (!branch) branch = String((await gh(['api', 'repos/' + repo])).default_branch || 'main')
      if (!BRANCH.test(branch)) throw new Error('not a branch name: ' + JSON.stringify(branch.slice(0, 60)))
      const j = await gh(['api', 'repos/' + repo + '/actions/runs?branch=' + encodeURIComponent(branch) + '&per_page=30'])
      const runs = (j.workflow_runs || []).map((r) => ({ id: r.id, workflow_id: r.workflow_id, name: r.name, status: r.status, conclusion: r.conclusion }))
      const out = eventsForRuns(lane, runs, memo)
      if (out.length) await send(out)
      return true
    } catch (err) {
      log(`undertone ${name}: ${err.message}`)
      return false
    } finally {
      running = false
    }
  }
  return { lane, tick }
}
