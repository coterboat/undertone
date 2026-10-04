# undertone roadmap

Updated 2026-10-04, at 0.7.0. What's built, what's next and in what order, and what waits on purpose. The day-to-day threads live in coter-kit's brain; this is the plan they hang off. Change it when the order changes.

## Where it is

| Version | What it added |
| :- | :- |
| v0 (`8cefeab`) | Your Claude Code sessions played as music |
| v1 (`d948567`) | Four engines (Synth, Sampled, Strudel, SuperCollider), a call per session for "your move" and "needs your OK", Projects with a lead, the real waiting count from the brain, listed in coter-kit's marketplace |
| 0.2 (`69319af`..`10efa1b`) | Ears (clips Claude can read) and the Gemini critic, the event log, phone pings over ntfy, outside sources (Azure) |
| 0.3.0 (`0f491f8`) | Grok's hardening pass, `GET /state`, failing checks named by kind |
| 0.4.0 (`d980922`) | The bridge runs outside sources itself (one window), the Azure source works on Windows, the ourPlace lane tells chats from requests, this roadmap |
| 0.5.0 (`84696b9`) | Timesheets: each machine writes a small daily summary per project into the brain; `npm run week` and `GET /timesheet` add up every machine's |
| 0.6.0 | A bridge that's simply there: the first session starts it detached, it leaves after a quiet hour, `/undertone stop` holds until you start it again |
| 0.6.1 | A design pass on the page: commits and pushes marked in the lane that made them, hover tips on the score, a compact engine switch so the score sits near the top |
| 0.6.2 | The page on your phone: the bridge also answers names listed in `hosts.json` (the Mac under `tailscale serve`), and the page it serves there runs live |
| 0.6.3 (`2124e76`) | The pops: buses pinned to stereo (a mono kick plus stereo noise flipped the drum bus's channel count on every hit, and each flip popped through the filters after it). Synth: softer snare, rounder kick and mallet, the kick ducks the bass, laid-back hats. The ears record on the audio thread |
| 0.7.0 | GitHub Actions as an outside source (builds heard starting and finishing, a red workflow holds `ci:<workflow>`); tests that fail instead of hanging; the event log keeps its order through a stop |

## Now

1. **Live with ourPlace prod for a few days.** Does the lane tell you anything you'd act on? Tune `failAt`, and which metrics play, from what you hear. Only counts come through; per-chat events would need App Insights on the site, a client prod change and your call.
2. **Judge the engines by ear** (waiting on you): which engine and vibe wins decides where sound work goes. https://claude.ai/artifact/JapnkciDwNgUNTgfY8UPrZ

## Next, in order

1. **Home dashboard** on `GET /state` and `GET /timesheet`: every session at a glance, what needs you first, what's failing. The data is there since 0.3.
2. **Synth tuning loop.** First round in 0.6.3 (the pops, the snare's snap, the bass under the kick), measured with a before/after rig: two scratch bridges replaying the same real events into two muted pages. Still open from earlier reads: mud at 180-300 Hz, hiss sitting alone on top.
3. **More outside sources**, each a lane that colors the music without leading it: wallstbets bots (fills as pulses, a stalled bot as a failing check), a Grok review landing. (GitHub Actions came in 0.7.0.)

## Later, on purpose

- **The agent speaks before it acts.** Before undertone's agent gets any freedom, it says (by sound and in `/state`) what it would do, so you can judge when it's ready.
- **Guardrails (blocking hooks)** only after that, and after undertone has run longer.
- **A real database** when home needs queries over months. The daily summary is already shaped like its row; raw events stay local.

## Decided against, for now

- Counting waiting questions from coter-kit's live status files instead of its journal (10-4). The files hold each session's own project, on its own machine, for 7 days: the drone would lose projects with no session on this machine lately (xcombaby today, everything worked only on the PC). The journal costs 2 ms to count and the numbers agree. Worth revisiting if coter-kit writes one file with every project's count.

- Guessing open questions from thread text. Only coter-kit's `waiting` notes count, so the drone never hums about something you don't owe.
- Syncing raw logs between machines: up to half a megabyte a day each, mostly heartbeats. The daily summary carries what matters.
- Deleting logs and clips by default. They're your history and what teaches Claude to hear; `UNDERTONE_LOG_DAYS` and `UNDERTONE_EAR_DAYS` are there when you want it.

## Known gaps

- Phone pings skip the "file readable by others" check on Windows (no chmod there).
- The detached start is proven on the Mac; on Windows it's tested only in the mod's tests until the PC runs 0.6.
- A plugin install from GitHub needs SSH, or git told to use HTTPS for github.com (what the PC does).
