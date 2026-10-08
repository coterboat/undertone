# Listening reviews

Love this, This grates and Snapshot save evidence (`~/.undertone/ear`: the last 20 or 30 seconds, a
spectrogram, the numbers, what was playing, the events around it, and a Gemini critique when its quota
allows). Nothing reads them back into the music by itself. A listening review does, once a week: it reads
what you saved since the last one, finds what's consistent, traces it to the code, and proposes tuning.
It never changes the music on its own; you pick what gets built.

Reviews that led to changes are kept here, one per date. A scheduled review writes to
`~/.undertone/listening/<date>.md` and leaves a waiting note (`LISTEN-<date>`) in coter-kit's brain; the
session that builds what you pick copies the report here with the change.

## How to run one

1. **Since when:** the date of the newest report here or in `~/.undertone/listening/` (all of it, the first
   time).
2. **The numbers:** `node ear/review.mjs --since <date>`: loved and grated clips by engine and mood
   (loudness, peaks, brightness, band balance, clicks), each grated clip on its own, loudness spread
   between moods, faults, loves by hour.
3. **Look:** open the `spectrogram.png` of every grated clip, and of two or three loved clips of the same
   engine and mood to set against it. Read their `state.json` (tier, drive, busy lanes) and `note`.
4. **Gemini:** read the `critique.md` files since the date (more than ten: hand them to a cheaper subagent
   for recurring points with counts and clip ids). Weigh them by how many agree; note dissent.
5. **Trace it to the code:** a pattern isn't a finding until you've found what makes it
   (`sc/undertone.scd`, `web/engines/*.js`, `web/index.html`). Say where.
6. **Write it** (the 2026-10-07 report is the shape): what you love, what grates, Gemini's recurring
   points, numbers that aren't opinions, proposals ordered by evidence, then the numbers as printed.
   Check every count you quote against the data before saving.
7. **Ask:** save one coter-kit waiting note, ref `LISTEN-<date>`, with the top proposals as its options
   and the report's path. Don't build anything in a scheduled run.

## Reviews

| Date | Clips | What came of it |
| :- | -: | :- |
| [2026-10-07](2026-10-07.md) | 194 (184 loved, 5 grated) | The first. SuperCollider's low end is what grates; moods 6.6 dB apart; Afterhours too relentless for all day |
