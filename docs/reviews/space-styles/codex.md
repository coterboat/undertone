## 1. What’s missing

The scores work because of orchestration discipline, not merely their synths and harmony. This plan needs explicit rules for **register, density, and foreground privilege**. If bass pulse, arpeggio, pads, calls, failures, asks, and drums all react independently, the result will be attractive but unreadable. At any moment, only one informational voice should occupy the foreground; everything else must duck, thin, or move registers.

The fixed root pedal is overused here. It creates continuity, but hours of constant low-frequency energy become physically tiring and blur harmonic motion. Give the bass planned absences, octave displacement, and occasional fifths.

“One wet room” also needs qualification. Long reverb unifies a score, but it destroys transient identity in a browser mix. Share the hall’s character, not one send level: pads can be wet; tool events and calls need a dry onset plus reverberant tail.

Finally, both references rely on **slow internal evolution**: voicing inversions, orchestral handoffs, changing subdivisions, and automation that is not necessarily dramatic. Your plan mostly describes adding layers. Addition alone makes every arc feel like the same crescendo.

## 2. Attacking the ideas

**1. Far shore:** Strong palette, weak information model. Feeding every tool call into one arpeggio risks erasing both lane and event identity. Preserve each lane’s fixed register, pan neighborhood, and oscillator character; let calls replace or accent scheduled steps rather than merely increasing density. Dotted-eighth delay should stay below roughly 15% wet during activity or it will generate false events.

**2. Deep field:** Too many expensive, slow-speaking instruments for telemetry. Choir, strings, horn, harp, organ, and timpani will mask signals and make fallback synthesis feel like a different product. Start with strings, horn, and one synthetic bed. Choir should mark rare structural events, not intensity.

**3. Intensity tiers:** Useful, but an eight-bar minimum is sometimes two minutes of stale information. Separate musical stability from alert responsiveness: arrangement tiers can wait for phrase boundaries; asks and failures cannot. Use asymmetric thresholds—rise after sustained activity, fall more slowly—and change only one orchestration dimension per transition.

**4. Build and release:** A filter continuously climbing through a long turn becomes an alarm with no actionable meaning. Quantize duration into two or three milestones, then stop developing. Release only on that lane, not across the whole room.

**5. Failures that don’t nag:** Correct direction, but “settling into the texture” may hide an unresolved failure. After the initial signal, reduce brightness and repetition—not semantic audibility. Give it a brief, low-level reminder at long, irregular musical intervals.

**6. Factions:** Timbre identifies projects only if assignments are stable for weeks. Organ/choir/horn also differ wildly in salience. Normalize loudness and attack, and reserve a small identifying layer rather than swapping the entire lead instrument.

**7. Home motif:** A four-note brand motif will become UI-logo fatigue if commits and transitions are frequent. Use one intervallic contour with several compressed realizations: two-note cadence for routine commits, full form only for takeover or deploy.

**7/8 experiment:** Reject it. Changing the global meter because one permission waits punishes every listener and disrupts concurrent lanes. Put only that lane into a quiet 7-step accent cycle against unchanged 4/4.

## 3. Three additions

- **Attention arbitration:** rank signals by urgency, allowing one foreground event at a time; queue lower-priority stingers to the next beat.
- **Spectral occupancy as status:** inactive projects become narrow and high-passed; the leader gains low-mid body; urgent signals briefly clear a masked frequency pocket.
- **Finite variation cells:** prepare several equivalent voicings, arp rotations, and articulations for each semantic state. Variation changes surface, never meaning.

## 4. First build

Build **Far shore’s lane-preserving activity ostinato**, before generalized tiers. It tests the central claim: can activity become music without losing who did what?

Use one pulse oscillator per lane, plus a saw one octave above at −12 dB. Run both through a 24 dB/oct low-pass: 700 Hz at rest, up to 2.4 kHz with activity; resonance 0.15–0.3. Amp envelope: 8 ms attack, 90 ms decay, sustain 0, 50 ms release. Sixteenth-note clock at 104–110 BPM; reads occupy root/fifth in C2–C3, edits chord tones in C3–C4, commands accented in C4–C5. Velocity 0.18–0.42. Give each lane a fixed ±18% pan position and slight pulse-width difference. Add a filtered sine bass pulse in C1–C2 on eighths, but mute it for one bar every four. Use a 1/8-dotted delay at 10% wet, feedback 0.18, high-passed at 500 Hz, plus a 2.8-second hall whose send falls as density rises.

Reviewed from this document only.
