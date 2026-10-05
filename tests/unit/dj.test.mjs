import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeck, onBar, claim, landingBar, diatonic, pivotIndex, DEFAULTS } from '../../lib/dj.mjs'

const MOOD = { jobsnearme: 'bright', ascendant: 'lofi', undertone: 'farshore', 'coter-kit': 'deepfield' }
const moodOf = (p) => MOOD[p] || 'lofi'
const { HOLD_BARS, PHRASE, BLEND_BARS, CHALLENGE_BARS, TAKEOVER_BARS } = DEFAULTS

// Runs bars from..to-1 with the same scores, collecting every change that lands
function run(deck, from, to, scores, pinned = null, isOn) {
  const landed = []
  for (let bar = from; bar < to; bar++) {
    const r = onBar(deck, bar, { scores: typeof scores === 'function' ? scores(bar) : scores, pinned, moodOf, isOn })
    if (r.landed) landed.push({ bar, ...r.landed })
  }
  return landed
}

test('the first project to work starts the music at once, and nobody busy changes nothing', () => {
  const deck = createDeck()
  assert.deepEqual(run(deck, 0, 4, {}), [])
  const landed = run(deck, 4, 5, { undertone: 0.5 })
  assert.equal(landed.length, 1)
  assert.equal(landed[0].mood, 'farshore')
  assert.equal(landed[0].blend, false)
  assert.equal(deck.since, 4)
})

test('a busier project takes over only after out-busying the lead for a stretch, on a phrase boundary, after a blend', () => {
  const deck = createDeck('undertone', 'farshore', 0)
  // A spike shorter than the challenge changes nothing
  assert.deepEqual(run(deck, 0, CHALLENGE_BARS - 1, { undertone: 0.2, jobsnearme: 0.9 }), [])
  assert.deepEqual(run(deck, CHALLENGE_BARS - 1, CHALLENGE_BARS + 4, { undertone: 0.6, jobsnearme: 0.5 }), [])
  assert.equal(deck.lead, 'undertone')
  // Sustained, it takes the lead, and the change is cued for a phrase boundary at least a blend away
  const start = CHALLENGE_BARS + 4
  const landed = run(deck, start, start + CHALLENGE_BARS + 2 * PHRASE, { undertone: 0.2, jobsnearme: 0.9 })
  assert.equal(landed.length, 1)
  const { bar, mood, reason, blend } = landed[0]
  assert.equal(mood, 'bright')
  assert.equal(reason, 'lead')
  assert.equal(blend, true)
  assert.equal(bar % PHRASE, 0)
  assert.ok(bar >= HOLD_BARS)
  assert.ok(bar - (start + CHALLENGE_BARS - 1) >= BLEND_BARS + 1, 'cued at least a blend before it lands')
})

test('a track holds its minimum even when the lead changes early', () => {
  const deck = createDeck('undertone', 'farshore', 100)
  deck.lead = 'jobsnearme' // as if it had just won the challenge
  const landed = run(deck, 101, 100 + HOLD_BARS + PHRASE, { jobsnearme: 0.9 })
  assert.equal(landed.length, 1)
  assert.equal(landed[0].bar, 100 + HOLD_BARS)
})

test('a cued lead change is dropped if the lead moves back before the breakdown', () => {
  const deck = createDeck('undertone', 'farshore', 0)
  deck.lead = 'jobsnearme'
  onBar(deck, HOLD_BARS - PHRASE, { scores: { jobsnearme: 0.9 }, moodOf })
  assert.equal(deck.next && deck.next.project, 'jobsnearme')
  deck.lead = 'undertone'
  onBar(deck, HOLD_BARS - PHRASE + 1, { scores: { undertone: 0.9 }, moodOf })
  assert.equal(deck.next, null)
})

test('your pick changes the music at the next even bar, without waiting out the hold', () => {
  const deck = createDeck('undertone', 'farshore', 0)
  const landed = run(deck, 3, 12, { undertone: 0.9 }, 'coter-kit')
  assert.equal(landed.length, 1)
  assert.equal(landed[0].mood, 'deepfield')
  assert.equal(landed[0].reason, 'you')
  assert.equal(landed[0].bar, 6) // decided in bar 3: a blend in bars 4-5, in on bar 6
})

test("a push from another project takes over for a while, lands on a 4-bar line, then hands back to the lead", () => {
  const deck = createDeck('undertone', 'farshore', 0)
  run(deck, 0, 40, { undertone: 0.8 })
  assert.equal(claim(deck, 'jobsnearme', 41, 1_000_000, moodOf), 'takeover')
  const landed = run(deck, 41, 41 + TAKEOVER_BARS + 14, { undertone: 0.8 })
  assert.equal(landed.length, 2)
  const [take, back] = landed
  assert.equal(take.reason, 'takeover')
  assert.equal(take.mood, 'bright')
  assert.equal(take.bar % 4, 0)
  assert.ok(take.bar - 41 >= BLEND_BARS + 1)
  assert.equal(back.reason, 'return')
  assert.equal(back.mood, 'farshore')
  // 16 full bars, then the two-bar breakdown, then the lead (Codex RV-002 F3: it was 14 full bars)
  assert.equal(back.bar, take.bar + TAKEOVER_BARS + BLEND_BARS)
  assert.equal(deck.next, null)
})

test("a push from the project on the deck is a surge; claims cool down per project; a takeover isn't interrupted", () => {
  const deck = createDeck('undertone', 'farshore', 0)
  assert.equal(claim(deck, 'undertone', 10, 0, moodOf), 'surge')
  assert.equal(claim(deck, 'undertone', 12, 60_000, moodOf), null)
  assert.equal(claim(deck, 'undertone', 900, DEFAULTS.CLAIM_COOLDOWN_MS + 1, moodOf), 'surge')
  assert.equal(claim(deck, 'ascendant', 20, 0, moodOf), 'takeover')
  assert.equal(claim(deck, 'jobsnearme', 21, 0, moodOf), null)
  assert.equal(deck.next.project, 'ascendant')
})

test("a push during a breakdown doesn't cut it off", () => {
  const deck = createDeck('undertone', 'farshore', 0)
  run(deck, 0, 3, { undertone: 0.9 }, 'coter-kit') // you picked coter-kit in bar 0: the blend in bars 2-3, in on 4
  assert.equal(deck.next.at, 4)
  assert.equal(claim(deck, 'jobsnearme', 2, 0, moodOf), null)
  assert.equal(deck.next.project, 'coter-kit')
  assert.equal(deck.claims.jobsnearme, undefined, "a refused claim doesn't start the cooldown")
})

test('landing bars count from where the track started', () => {
  const deck = createDeck('undertone', 'farshore', 6)
  assert.equal(landingBar(deck, 10), 14)
  assert.equal(landingBar(deck, 11), 14) // decided in bar 11: the blend in 12-13
  assert.equal(landingBar(deck, 12), 22)
  assert.equal(landingBar(deck, 12, 2), 16)
})

test('the pivot is the incoming chord that sits in the outgoing key', () => {
  const pcs = (root, ivs) => new Set(ivs.map((i) => (root + i) % 12))
  const farshore = { tonic: 40, scale: [0, 2, 3, 7, 10] } // E minor
  // Deep field (D minor): Dm(add9), Cadd9, Bbmaj7, Am7. C and Am are in E minor; Dm and Bb aren't
  const deepfield = [pcs(50, [0, 3, 7, 14]), pcs(60, [0, 4, 7, 14]), pcs(58, [0, 4, 7, 11]), pcs(57, [0, 3, 7, 10])]
  assert.equal(pivotIndex(farshore, deepfield), 1)
  // Daylight (D major) from Deep field: nothing fits whole; A9sus4 (one note out of five) fits best
  const deepKey = { tonic: 50, scale: [0, 2, 3, 7, 10] }
  const daylight = [pcs(55, [0, 4, 7, 11]), pcs(54, [0, 3, 7, 10]), pcs(52, [0, 3, 7, 10, 14]), pcs(57, [0, 5, 7, 10, 14])]
  assert.equal(pivotIndex(deepKey, daylight), 3)
  assert.deepEqual([...diatonic({ tonic: 45, scale: [0, 2, 3, 7, 9] })].sort((a, b) => a - b), [0, 2, 4, 6, 7, 9, 11]) // A dorian
})

test("when you change who may lead, the busiest project takes the deck at once", () => {
  const deck = createDeck('undertone', 'farshore', 0)
  run(deck, 0, 4, { undertone: 0.8, jobsnearme: 0.5 })
  deck.asked = true // undertone turned off: it drops out of the scores
  const landed = run(deck, 4, 10, { jobsnearme: 0.5 })
  assert.equal(landed.length, 1)
  assert.equal(landed[0].project, 'jobsnearme')
  assert.equal(landed[0].reason, 'you')
  assert.equal(deck.asked, false)
})

test('a lead change between two projects in the same mood still gets its breakdown (RV-002 F1)', () => {
  const deck = createDeck('ascendant', 'lofi', 0)
  const landed = run(deck, 0, CHALLENGE_BARS + 3 * PHRASE, { ascendant: 0.1, tablehand: 0.9 })
  assert.equal(landed.length, 1)
  assert.equal(landed[0].project, 'tablehand')
  assert.equal(landed[0].mood, 'lofi')
  assert.equal(landed[0].blend, true)
})

test('your choices beat a takeover (RV-002 F2)', () => {
  // One still waiting for its breakdown is dropped
  let deck = createDeck('undertone', 'farshore', 0)
  run(deck, 0, 40, { undertone: 0.8 })
  claim(deck, 'jobsnearme', 40, 1, moodOf)
  assert.equal(deck.next.reason, 'takeover')
  deck.asked = true // you turned jobsnearme off
  run(deck, 41, 42, { undertone: 0.8 })
  assert.equal(deck.next, null)
  assert.equal(deck.on, 'undertone')
  // One playing hands over at the next two-bar line after a blend
  deck = createDeck('undertone', 'farshore', 0)
  run(deck, 0, 40, { undertone: 0.8 })
  claim(deck, 'jobsnearme', 40, 1, moodOf)
  const took = run(deck, 41, 50, { undertone: 0.8 })
  assert.equal(took[0].reason, 'takeover')
  const pinAt = took[0].bar + 2
  deck.asked = true // the page sets it when you click a pin, so a standing pin doesn't cancel later takeovers
  const after = run(deck, pinAt, pinAt + 8, { undertone: 0.8 }, 'coter-kit')
  assert.equal(after.length, 1)
  assert.equal(after[0].project, 'coter-kit')
  assert.equal(after[0].reason, 'you')
  assert.ok(after[0].bar - pinAt <= BLEND_BARS + 2, 'lands within a few bars, not at the end of the takeover')
})

test("turning off the project playing: the next one to work takes the deck at once (RV-003 F2)", () => {
  const deck = createDeck('undertone', 'farshore', 0)
  const isOn = (p) => p !== 'undertone'
  deck.asked = true
  assert.deepEqual(run(deck, 0, 10, {}, null, isOn), [], 'nobody working: the music stays put')
  const landed = run(deck, 10, 18, { jobsnearme: 0.4 }, null, isOn)
  assert.equal(landed.length, 1)
  assert.equal(landed[0].project, 'jobsnearme')
  assert.ok(landed[0].bar <= 14, 'within a few bars, not after a 32-bar challenge')
})

test("your choice wins a race with a takeover about to land (RV-003 F4)", () => {
  const deck = createDeck('undertone', 'farshore', 0)
  run(deck, 0, 40, { undertone: 0.8 })
  claim(deck, 'jobsnearme', 40, 1, moodOf)
  const at = deck.next.at
  run(deck, 41, at, { undertone: 0.8 })
  deck.asked = true // you turned jobsnearme off just before it landed
  const landed = run(deck, at, at + 1, { undertone: 0.8 })
  assert.deepEqual(landed, [])
  assert.equal(deck.on, 'undertone')
  assert.equal(deck.takeover, null)
})
