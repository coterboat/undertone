# undertone roadmap

Updated 2026-10-03, at 0.4.0. What's built, what's next and in what order, and what waits on purpose. The day-to-day threads live in coter-kit's brain; this is the plan they hang off. Change it when the order changes.

## Where it is

| Version | What it added |
| :- | :- |
| v0 (`8cefeab`) | Your Claude Code sessions played as music |
| v1 (`d948567`) | Four engines (Synth, Sampled, Strudel, SuperCollider), a call per session for "your move" and "needs your OK", Projects with a lead, the real waiting count from the brain, listed in coter-kit's marketplace |
| 0.2 (`69319af`..`10efa1b`) | Ears (clips Claude can read) and the Gemini critic, the event log, phone pings over ntfy, outside sources (Azure) |
| 0.3.0 (`0f491f8`) | Grok's hardening pass, `GET /state`, failing checks named by kind |
| 0.4.0 (`d980922`) | The bridge runs outside sources itself (one window), the Azure source works on Windows, the ourPlace lane tells chats from requests, this roadmap |
| 0.5.0 | Timesheets: each machine writes a small daily summary per project into the brain; `npm run week` and `GET /timesheet` add up every machine's |

## Now

1. **Live with ourPlace prod for a few days.** Does the lane tell you anything you'd act on? Tune `failAt`, and which metrics play, from what you hear. Only counts come through; per-chat events would need App Insights on the site, a client prod change and your call.
2. **Judge the engines by ear** (waiting on you): which engine and vibe wins decides where sound work goes. https://claude.ai/artifact/JapnkciDwNgUNTgfY8UPrZ

## Next, in order

1. **A bridge that's simply there.** Today it lives in a terminal (`npm start`) or as long as the session that ran `/undertone`. Start it detached with the first session and let it exit after a quiet hour, so there's nothing to keep open.
2. **Home dashboard** on `GET /state` and `GET /timesheet`: every session at a glance, what needs you first, what's failing. The data is there since 0.3.
3. **Synth tuning loop.** Agreed by spectrogram and two Gemini reads: drums buried, mud at 180-300 Hz, hiss sitting alone on top. Before and after spectrograms per change. Waits on the engine verdict above, in case Synth isn't the keeper.
4. **More outside sources**, each a lane that colors the music without leading it: wallstbets bots (fills as pulses, a stalled bot as a failing check), GitHub Actions (a red run as a check), a Grok review landing.

## Later, on purpose

- **The agent speaks before it acts.** Before undertone's agent gets any freedom, it says (by sound and in `/state`) what it would do, so you can judge when it's ready.
- **Guardrails (blocking hooks)** only after that, and after undertone has run longer.
- **A real database** when home needs queries over months. The daily summary is already shaped like its row; raw events stay local.

## Decided against, for now

- Guessing open questions from thread text. Only coter-kit's `waiting` notes count, so the drone never hums about something you don't owe.
- Syncing raw logs between machines: up to half a megabyte a day each, mostly heartbeats. The daily summary carries what matters.
- Deleting logs and clips by default. They're your history and what teaches Claude to hear; `UNDERTONE_LOG_DAYS` and `UNDERTONE_EAR_DAYS` are there when you want it.

## Known gaps

- Phone pings skip the "file readable by others" check on Windows (no chmod there).
- A plugin install from GitHub needs SSH, or git told to use HTTPS for github.com (what the PC does).
