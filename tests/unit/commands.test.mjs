import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCommand, outcomes } from '../../hooks/commands.js'

const events = (cmd, ok) => outcomes(analyzeCommand(cmd), ok)

// Grok's table, plus the ways a real session runs its checks
const TABLE = [
  ['git log --grep commit', true, []],
  ['git commit --dry-run', true, []],
  ['git -C x commit -m "make it work"', true, [{ type: 'commit' }]],
  ['git commit -m "run npm test"', true, [{ type: 'commit' }]],
  ['echo make sure', true, []],
  ['make test', false, [{ type: 'fail', check: 'test' }]],
  ['make', true, [{ type: 'pass', check: 'build' }]],
  ['make install', true, []],
  ['npm test | tail -20', false, []],
  ['npm test | tail -20', true, []],
  ['set -o pipefail; npm test | tail', false, [{ type: 'fail', check: 'test' }]],
  ['npm test || true', false, []],
  ['npm test || true', true, []],
  ['cd app && npm run typecheck', false, [{ type: 'fail', check: 'typecheck' }]],
  ['git add -A && git commit -m x && git push', true, [{ type: 'commit' }, { type: 'push' }]],
  ['npm test; echo done', true, []],
  ['npm test &', true, []],
  ['npx vitest run', false, [{ type: 'fail', check: 'test:vitest' }]],
  ['npm run lint', true, [{ type: 'pass', check: 'lint' }]],
  ['claude plugin test . 2>&1 | tail -3', true, []],
  ['claude plugin test .', false, [{ type: 'fail', check: 'test:claude' }]],
  ['npm run typecheck # FAIL', false, [{ type: 'fail', check: 'typecheck' }]],
  ['cat <<EOF > notes.md\nnpm test\nEOF', true, []],
  ['npm test && npm run lint', false, []],
  ['npm test && npm run lint', true, [{ type: 'pass', check: 'test' }, { type: 'pass', check: 'lint' }]],
  ['git push --dry-run', true, []],
  ['git commit -m x', false, []],
]

for (const [cmd, ok, want] of TABLE) {
  test(`${JSON.stringify(cmd)} ${ok ? 'succeeding' : 'failing'}`, () => {
    assert.deepEqual(events(cmd, ok), want)
  })
}

test('nothing from the command comes out: only booleans and check names', () => {
  const a = analyzeCommand('git commit -m "secret plan for FS-304" && npm test')
  assert.doesNotMatch(JSON.stringify(a), /secret|FS-304/)
})
