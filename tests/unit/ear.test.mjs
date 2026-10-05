import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeClip, pitchEdge } from '../../ear/analyze.mjs'

const SR = 48000

// A note on a pulse wave (Far shore's sessions): sharp edges every cycle, softened by a one-pole low-pass
function pulseNote(seconds, hz, at, { width = 0.2, level = 0.25, cutoff = 2400 } = {}) {
  const x = new Float32Array(Math.round(seconds * SR))
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR - at
    const env = t < 0 ? 0 : Math.min(1, t / 0.006) * Math.exp(-t / 0.3)
    const raw = t < 0 ? 0 : ((t * hz) % 1 < width ? 1 : -1) * level * env
    y += a * (raw - y)
    x[i] = y
  }
  return x
}

const sine = (seconds, hz, level) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR) * level)
const clicksIn = (x) => Math.round((analyzeClip(x, SR).stats.clicksPerMinute * x.length) / SR / 60)

test("a pulse wave's edges are a tone, not clicks", () => {
  const x = pulseNote(2, 165, 0.5)
  let edge = 0
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - x[i - 1]) > Math.abs(x[edge] - x[edge - 1] || 0)) edge = i
  assert.ok(Math.abs(x[edge] - x[edge - 1]) > 0.03, 'the edges are big enough to be taken for clicks')
  assert.equal(pitchEdge(x, edge, SR), true)
  assert.equal(clicksIn(x), 0)
})

test('a glitch in a sine is one click', () => {
  const x = sine(2, 220, 0.2)
  for (let i = SR; i < x.length; i++) x[i] += 0.08 // a DC step, the kind a buffer flip makes
  assert.equal(clicksIn(x), 1)
})

test('a glitch on top of a pulse note still counts', () => {
  const x = pulseNote(2, 110, 0.2)
  for (let i = SR; i < x.length; i++) x[i] += 0.3
  assert.equal(clicksIn(x), 1)
})
