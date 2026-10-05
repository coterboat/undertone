CANARY: repository, filesystem, and tool context are visible beyond the packet.

### F1 · high · correctness
File: lib/dj.mjs:52  
Claim: A normal lead change between two projects using the same mood skips the required two-bar breakdown. For example, two unconfigured projects both use the default `lofi` mood; after the challenger wins, it lands with drums and layers still playing.  
Evidence: `cue()` sets `blend: mood !== deck.mood`; `web/index.html` starts a breakdown only when `n.blend` is true. The lead-change test uses different moods, so it misses this common case.  
Fix: Base `blend` on whether the deck/project is changing, not whether the mood key differs. Keep the no-blend exception only for initial playback.

### F2 · high · correctness
File: web/index.html:1846  
Claim: Turning off a pending or active takeover project does not stop its takeover, and pinning another lead during a takeover can wait nearly 16 bars rather than landing at the next two-bar line.  
Evidence: `setProjectOn()` sets `deck.asked` only when the disabled project is `deck.lead`; during a takeover it is instead `deck.on` or `deck.next.project`. In `onBar()`, pending takeovers are protected from cancellation and active takeovers return early until their scheduled handback.  
Fix: Route listener choices through an explicit high-priority DJ request. Cancel a not-yet-landed takeover for a disabled project and cue an active takeover’s exit or pinned choice at the next eligible two-bar landing.

### F3 · high · correctness
File: lib/dj.mjs:94  
Claim: A takeover advertised as “full tier for 16 bars” is full for only 14 bars.  
Evidence: A takeover ending at `T + 16` cues its return at `T + 13`; `web/index.html` starts `S.blend` at `T + 14`, where `updateTier()` removes all style layers and the drum target becomes zero. The test checks only that return lands at `T + 16`, not the arrangement during bars 14–15.  
Fix: Give the takeover 16 complete full-arrangement bars, then schedule the two-bar return breakdown, and test drum/layer state throughout the interval.

### F4 · medium · correctness
File: ear/analyze.mjs:136  
Claim: Periodic buffer-boundary or retrigger glitches between 40–660 Hz are classified as pitched edges and can produce a false “0 clicks.” A mismatched 128-sample buffer repeated at 48 kHz has the same-sign discontinuity every 2.67 ms; `pitchEdge()` finds three repetitions and suppresses every boundary.  
Evidence: The classifier relies only on three repeated same-direction steps at a permitted period. The tests cover one isolated DC step and one oversized glitch, but no periodic buffer flip or retrigger pop.  
Fix: Restrict suppression to regions positively identified as pulse/saw waveforms rather than arbitrary repeated discontinuities, and add periodic buffer-restart and retrigger fixtures at common block sizes.
