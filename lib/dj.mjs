// undertone's DJ: which project has the deck, when the music may change, and the chord it changes on.
// Shared by the page (which asks it once a bar) and the tests and replay tool (which drive it the same
// way over real logs). Pure: no audio, no clocks; bars and `now` (milliseconds) are passed in.
//
// The rules (docs/space-styles.md, "DJ"):
//   - A track holds at least HOLD_BARS before the lead can change it, and changes only on its own
//     phrase boundaries (every PHRASE bars from where it started).
//   - A project takes the lead by out-busying the one on the deck by MARGIN for CHALLENGE_BARS bars
//     running (about 80 seconds), not for one four-second look. Replayed over the 10-3 and 10-4 logs:
//     the old rule changed the mood 6.6 and 10.2 times an hour, the shortest after 1.5 bars (two
//     sessions trading the lead was a radio); these numbers make it 2.2 and 2.4, none under 16 bars.
//   - Before a change, BLEND_BARS of breakdown: the drums and pulse drop out, the pad holds a pivot
//     chord the two keys share, the tempo glides. The page plays that part; `next` says when.
//   - A push, or a CI run going green, is a claim. From a project that isn't on the deck it's a
//     takeover: its music for TAKEOVER_BARS, landing in full, then the deck goes back to the lead.
//     From the project on the deck, a surge (the full tier for a while). One claim per project per
//     CLAIM_COOLDOWN_MS: ascendant pushed 73 times on 10-4, and a takeover every 12 minutes is noise.
//   - What you choose (a lead, a project's mood) changes at the next even bar after a short blend.

export const DEFAULTS = {
  HOLD_BARS: 32,
  PHRASE: 8,
  BLEND_BARS: 2,
  CHALLENGE_BARS: 32,
  MARGIN: 0.3,
  TAKEOVER_BARS: 16,
  SURGE_BARS: 8,
  CLAIM_COOLDOWN_MS: 30 * 60_000,
}

// deck.on       the project whose music is playing (null before anyone has worked)
// deck.mood     the mood playing
// deck.since    the bar it started on (phrases count from here)
// deck.lead     the auto lead: who the deck goes back to after a takeover
// deck.next     a cued change: { project, mood, at, blend, reason } (reason: lead | takeover | return | you)
// deck.takeover { project, until } while a takeover plays
// deck.asked    set it when you changed who may lead (pinned, unpinned, turned a project off): the
//               busiest project (or your pin) takes the lead at once, without waiting out the hold or
//               a takeover
// opts: any of DEFAULTS, to tune (the replay tool tries others against real days)
export function createDeck(project = null, mood = null, bar = 0, opts = {}) {
  return { o: { ...DEFAULTS, ...opts }, on: project, mood, since: bar, lead: project, challenger: null, streak: 0, next: null, takeover: null, claims: {}, asked: false }
}

// Where a change decided during `bar` can land: the first boundary on `grid` (counted from the track's
// start) that leaves a full blend before it
export function landingBar(deck, bar, grid = deck.o.PHRASE) {
  const earliest = bar + 1 + deck.o.BLEND_BARS
  return deck.since + grid * Math.ceil(Math.max(0, earliest - deck.since) / grid)
}

// Every cued change gets its breakdown, even into the same mood: who's driving changed, and that's what
// you'd want to hear (Codex RV-002 F1). Only the first music anyone makes starts without one.
function cue(deck, project, mood, at, reason) {
  deck.next = { project, mood, at, blend: true, reason }
  return deck.next
}

// Called at the top of every bar. scores: { project: how busy } (the page leaves out quiet, outside and
// scheduled sessions); pinned: the project you chose to lead, or null; moodOf(project) -> its mood.
// Returns { landed } on the bar a cued change takes over, else {}.
export function onBar(deck, bar, { scores = {}, pinned = null, moodOf }) {
  const { HOLD_BARS, BLEND_BARS, CHALLENGE_BARS, MARGIN, TAKEOVER_BARS } = deck.o
  if (deck.next && bar >= deck.next.at) {
    const n = deck.next
    deck.next = null
    deck.on = n.project
    deck.mood = n.mood
    deck.since = n.at
    if (n.reason === 'takeover') deck.takeover = { project: n.project, until: n.at + TAKEOVER_BARS }
    else deck.takeover = null
    return { landed: n }
  }

  // Who should lead: you, or whoever has out-busied the lead long enough. Nobody busy changes nothing,
  // so an idle session can't steal the key.
  if (pinned) {
    deck.lead = pinned
    deck.challenger = null
    deck.streak = 0
  } else {
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a])
    const top = ranked[0]
    const cur = deck.lead != null && scores[deck.lead] != null ? scores[deck.lead] : -1
    if ((!deck.lead || deck.asked) && top) { deck.lead = top; deck.challenger = null; deck.streak = 0 }
    else if (top && top !== deck.lead && scores[top] > cur + MARGIN) {
      deck.streak = deck.challenger === top ? deck.streak + 1 : 1
      deck.challenger = top
      if (deck.streak >= CHALLENGE_BARS) { deck.lead = top; deck.challenger = null; deck.streak = 0 }
    } else { deck.challenger = null; deck.streak = 0 }
  }

  // A change still waiting for its breakdown is dropped if the lead moved on again meanwhile (a
  // takeover isn't: it was earned)
  if (deck.next && deck.next.reason !== 'takeover' && bar < deck.next.at - BLEND_BARS && deck.next.project !== deck.lead) deck.next = null
  // Yours beats a takeover (RV-002 F2): one still waiting for its breakdown is dropped, one playing
  // hands over at the next two-bar line
  if (deck.asked) {
    if (deck.next && deck.next.reason === 'takeover' && bar < deck.next.at - BLEND_BARS) deck.next = null
    if (deck.takeover && !deck.next) deck.takeover = null
  }
  if (deck.next) return {} // a change is already on its way
  if (deck.takeover) {
    // All of its bars at full, then the breakdown back to the lead (RV-002 F3: the breakdown ate two)
    if (bar < deck.takeover.until - 1) return {}
    const back = deck.lead || deck.on
    deck.takeover = null
    if (back && (back !== deck.on || moodOf(back) !== deck.mood)) cue(deck, back, moodOf(back), landingBar(deck, bar, 2), 'return')
    return {}
  }
  if (!deck.lead) { deck.asked = false; return {} }
  if (!deck.on) { // the first music anyone made: it starts now, no blend
    deck.on = deck.lead
    deck.mood = moodOf(deck.lead)
    deck.since = bar
    return { landed: { project: deck.on, mood: deck.mood, at: bar, blend: false, reason: 'lead' } }
  }
  const mood = moodOf(deck.lead)
  if (deck.lead === deck.on && mood === deck.mood) { deck.asked = false; return {} }
  // Your choices don't wait out the hold
  const yours = pinned || deck.asked || (deck.lead === deck.on && mood !== deck.mood)
  deck.asked = false
  if (yours) { cue(deck, deck.lead, mood, landingBar(deck, bar, 2), 'you'); return {} }
  const at = landingBar(deck, bar)
  if (at - deck.since < HOLD_BARS) return {}
  cue(deck, deck.lead, mood, at, 'lead')
  return {}
}

// A push or a green CI run from `project`. Returns 'takeover', 'surge' or null (cooling down, or a
// takeover already playing).
export function claim(deck, project, bar, now, moodOf) {
  if (!project || !deck.on) return null
  if (deck.takeover || (deck.next && deck.next.reason === 'takeover')) return null
  if (deck.next && bar >= deck.next.at - deck.o.BLEND_BARS) return null // a breakdown is already playing
  if (deck.claims[project] != null && now - deck.claims[project] < deck.o.CLAIM_COOLDOWN_MS) return null
  deck.claims[project] = now
  if (project === deck.on) return 'surge'
  cue(deck, project, moodOf(project), landingBar(deck, bar, 4), 'takeover')
  return 'takeover'
}

// ------------------------------------------------------------------ harmony

const MAJOR = [0, 2, 4, 5, 7, 9, 11], DORIAN = [0, 2, 3, 5, 7, 9, 10], AEOLIAN = [0, 2, 3, 5, 7, 8, 10]

// A mood's seven-note key, from its tonic and the pentatonic it keeps (a major third: major; a minor
// third with a major sixth: dorian; else aeolian)
export function diatonic(mood) {
  const steps = mood.scale.includes(4) ? MAJOR : mood.scale.includes(9) ? DORIAN : AEOLIAN
  return new Set(steps.map((i) => (mood.tonic + i) % 12))
}

// The chord to change on: of the incoming progression's chords (each given as its pitch classes), the
// one that sits best in the outgoing key, so the breakdown can hold it before the change and the new
// track can start from it. Ties go to the earlier chord.
export function pivotIndex(fromMood, toChords) {
  const key = diatonic(fromMood)
  let best = 0, bestScore = -Infinity
  toChords.forEach((pcs, i) => {
    const list = [...pcs]
    const inside = list.filter((pc) => key.has(pc)).length
    const score = inside / list.length - (list.length - inside) * 0.01
    if (score > bestScore) { best = i; bestScore = score }
  })
  return best
}
