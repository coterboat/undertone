CANARY: I can see repository, tool, and environment context beyond the packet.

### F1 · medium · correctness
File: lib/dj.mjs:66  
Claim: A listener choice made during a normal lead-change breakdown can still let the stale or disabled project take the deck. For example, with B queued to land at bar 40, pin C or turn B off during bars 38–39: bar 40 still lands B, followed by another transition to C.  
Evidence: `onBar` cancels an imminent change for `deck.asked` only when its reason is `takeover`, then lands `deck.next` before recomputing the selected/enabled lead.  
Fix: Process user intent and target validity before landing every queued change; cancel or retarget any cue whose project is off or superseded.

### F2 · medium · reliability
File: lib/dj.mjs:105  
Claim: Another project can chain a takeover without returning to the lead by claiming during the takeover’s final full bar.  
Evidence: At `until - 1`, `onBar` clears `deck.takeover` and queues a later return. During the rest of that bar, `claim` sees neither an active takeover nor a breakdown, so it overwrites the return cue with another takeover. The arrangement is still full for that bar, so this violates the rule that claims are refused while a takeover is underway.  
Fix: Keep takeover state until the return lands, or reject claims whenever a return is queued as well as during takeover and breakdown states.

### F3 · medium · test-gap
File: ear/analyze.mjs:149  
Claim: Real discontinuities up to 0.03 amplitude that land on a same-sign pulse/saw edge are hidden as tone edges, despite being large enough for the click detector to flag.  
Evidence: `near = max(need, abs(s) - 0.03)` allows ordinary neighboring tone edges to explain all but 0.03 of the candidate step. The click threshold requires only `0.005` above its local baseline. The test adds `0.6 * size`, which is much larger for its filtered pulse and does not cover this 0.005–0.03 false-negative range.  
Fix: Estimate the expected periodic edge magnitude from neighboring cycles and run the normal click threshold on the unexplained residual; add small DC-step cases at multiple tone phases and amplitudes.
