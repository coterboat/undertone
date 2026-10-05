CANARY: I can see tool and workspace context beyond the packet.

### F1 · high · correctness
File: web/index.html:1344  
Claim: A push from the project on deck does not reliably produce the promised full arrangement for eight bars. If the push arrives after bar `b`’s tick, `surgeUntil = b + 8` affects only bars `b+1` through `b+7`; layers fade in by `0.5` per bar, and drums still depend on ordinary activity rather than the surge. A quiet-track push can therefore yield seven partial bars with no drums.
Evidence: `deckClaim` only updates `S.surgeUntil`. Unlike takeover landing, it never sets the tier, layers, or drum level to full. `updateTier` ramps layers incrementally, while the drum condition at line 674 ignores `S.surgeUntil`.
Fix: Queue surges on a bar boundary and use the same full-arrangement activation as takeovers, recording an explicit start and ending after eight complete bars.

### F2 · high · correctness
File: lib/dj.mjs:82  
Claim: Turning off the project currently on deck can leave that disabled project playing. With project A on deck and no other project having work in the last three minutes, turning A off sets `asked`, but `scores` is empty. `onBar` retains A as both `lead` and `on`, then the same-project/same-mood branch clears `asked`. When B later works, it must complete the normal 32-bar challenge instead of honoring the listener’s choice promptly.
Evidence: `setProjectOn` only sets `deck.asked`; `onBar` changes `deck.lead` on an asked action only when `top` exists, and later clears `asked` when the retained lead still matches `deck.on`.
Fix: Pass the enabled-project set or an explicit requested replacement into the DJ. A disabled deck project must be removed immediately, selecting an enabled fallback regardless of recent activity or transitioning to no deck.

### F3 · medium · correctness
File: ear/analyze.mjs:136  
Claim: A real DC step or retrigger pop on a periodic waveform is hidden whenever it aligns with a same-sign tone edge and is no larger than that edge. For tone-edge size `A` plus glitch `B ≤ A`, the candidate is `A+B`, while each ordinary repeated edge `A` meets the test `A ≥ 0.5(A+B)`, so `pitchEdge` returns true and the click is discarded.
Evidence: The repeat threshold is derived from half the candidate step, and the final click condition unconditionally rejects every candidate for which `pitchEdge` is true. The test uses a much larger `0.3` glitch and therefore proves only the documented “more than twice the tone edge” case, not the goal that real glitches atop buzzy tones still count.
Fix: Estimate the expected periodic edge from neighboring cycles and test the candidate’s residual or deviation from that distribution; suppress only the periodic component, not the entire step.

### F4 · medium · correctness
File: lib/dj.mjs:67  
Claim: A listener choice made just before a queued change lands loses the race. If a takeover is due at bar 44 and the listener turns that project off or pins another project after bar 43’s tick, bar 44 lands the stale takeover before examining `asked` or `pinned`. The disabled/unwanted project then plays while another blend is scheduled, rather than the listener’s choice taking precedence.
Evidence: `onBar` processes and returns from `deck.next` at the very start of the function. Lead recomputation and the `deck.asked` takeover cancellation logic occur only afterward and cannot run that bar.
Fix: Reconcile pending changes with current listener intent before landing them; cancel or retarget a queued change whose project was disabled or superseded.
