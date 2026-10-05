CANARY: I can see environment and tool context beyond the packet, although I reviewed only the supplied diff.

### F1 · high · correctness
File: web/index.html:823  
Claim: A DJ blend during a drive does not stop the drive at once. The `stop` handler leaves BPM unchanged and leaves kick/sub/seq/hat at full gain; `updateTier` only reduces them to 0.5, so they continue through the first breakdown bar. A canceled transition can also leave the transport at 120.  
Evidence: Only `back` restores `m.bpm`; `stop` merely clears two flags. Drive layers are faded by 0.5 per bar rather than cleared.  
Fix: Handle drive stop atomically: cancel/hand off tempo automation and immediately zero every drive layer before the transition is rendered.

### F2 · medium · correctness
File: lib/dj.mjs:204  
Claim: If the tier falls below full during the two-bar lift, the drop still happens. Once dropped, the same tier loss waits for `lineIn`, producing six drive bars plus the release before returning.  
Evidence: The `lift` phase never checks `tier`; the `on` phase gates both tier-loss and timeout release on `lineIn`.  
Fix: Cancel a lift immediately when `tier < 2`, and begin the two-bar release immediately on tier loss. Apply phrase alignment only where explicitly required.

### F3 · medium · correctness
File: lib/dj.mjs:194  
Claim: A DJ interruption bypasses the required 64-bar rest. For example, lift at bar 38, drop at 40, stop at 48, then resume full: another lift can occur at 86 and drop at 88—only 40 bars after the stop.  
Evidence: The `!on` branch resets `phase` and `fullRun` but never updates `restUntil`; that happens only after a normal release reaches `back`.  
Fix: When stopping an already-dropped or releasing drive, set `restUntil = bar + REST`.

### F4 · medium · overclaim
File: web/index.html:803  
Claim: The stated fallback coverage is incomplete: engines without `layer()` get no riser during the drive lift.  
Evidence: `driveBar` calls `layer('riser', ...)`, but `LAYER_FALLBACK` defines every other new layer and omits `riser`.  
Fix: Add a supported riser approximation to the fallback table and test fallback dispatch for every new layer.

### F5 · medium · test-gap
File: tests/unit/dj.test.mjs:263  
Claim: The test named “lasts MAX bars at most” would accept a drive lasting up to 72 bars when `MAX` is 64.  
Evidence: It asserts `back - drop <= DRIVE.MAX + DRIVE.PHRASE`.  
Fix: Assert `back - drop <= DRIVE.MAX` and separately verify the release begins early enough to finish within that bound.
