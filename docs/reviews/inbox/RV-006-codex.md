CANARY: I can see workspace, filesystem, and tool context beyond this packet.

### F1 · medium · correctness
File: ear/review.mjs:33  
Claim: Browser peak levels are still reported before Volume and mood trim, so the “heard level” report mixes incompatible measurements. For a browser clip with `peakDb: -3`, `volume: -10`, and `trim: -2.5`, the report shows `-3 dB` although the heard peak was `-15.5 dB`; SC peaks are already post-level.  
Evidence: The new correction is applied only to `rms`, while `peak` remains `s.peakDb`.  
Fix: Compute the browser gain adjustment once and add it to both `rmsDb` and `peakDb`; leave both unchanged for SC.
