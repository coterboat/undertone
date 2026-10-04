# undertone

Your Claude Code sessions, played as music, and a way for them to tell you what needs you without you looking. Each session is a voice with its own three-note call, every tool call is a note, a commit resolves the chord, a broken build holds a sour note that names what broke, and every question waiting on you hums underneath until you answer.

Claude Code is the only coding tool it hears. Outside sources (a production site, a bot) can post events to it; Codex or Grok sessions would need sources of their own.

What's built, what's next and what waits on purpose: [docs/roadmap.md](docs/roadmap.md).

## Quick start

```bash
npm start
```

Then open http://127.0.0.1:4747 and press Play. With the plugin installed you don't need the terminal: the first Claude Code session starts the bridge in the background and it leaves after a quiet hour, so there's no window to keep open. `/undertone` opens the page (and starts the bridge if it isn't running).

## What needs you, by ear

| You hear | It means |
| :- | :- |
| A session's call ending on a rising, held note | That session needs you. A permission prompt asks again every minute (three times at most); an idle session asks once |
| A session's call settling on the chord's root | That session finished its turn: your move |
| A soft bell figure that rises and stays open, every so often | Questions waiting on you, counted from coter-kit's `waiting` notes in every project you have on. More questions, more often and longer (about every 40 s from ten on); a new one asks at once, an answer settles. It used to be a drone that grew with the count, which never stopped and sounded like a lawnmower |
| A session's call ending flat, then a sour note held over every chord | Something that session runs is broken. Each kind has its own sour note: tests a tritone, typecheck a high grinding second, lint a softer seventh, build a low second, production errors a low rumble, a red GitHub build a high tritone; the score names it ("tests (vitest) failing") |

A call comes from the project and worktree, not the session, so `jobsnearme · oct2-signup` sounds the same every time it starts and you learn who's calling. The ending carries the meaning: settled means done, rising means it needs you. Everything else is texture: tool calls are notes in the session's voice (reads low, edits on chord tones, commands high), drums fade in while Claude works, a commit or push resolves the progression home with bells in that session's lane, a checklist step climbs a bell, and a fixed check plays the session's call settled and slides the sour note into the chord. Each check fails and clears on its own: a passing lint doesn't clear failing tests.

A scheduled run (a desktop scheduled task) plays quietly: no calls when its turn ends, no notes for just looking around, only edits, commits, failures and a permission prompt that blocks it.

The score on the page shows the same: a row per session, a diamond in the row that committed or pushed, a red wave named after the check while it fails, a ring when a session needs you, and the questions waiting on you along the bottom (a small rise each time they're asked). Point at anything on it to see what it is, who made it and when.

## Sound engines

Pick one at the top of the page. The page conducts in every case (harmony, timing, who plays what), so you can switch mid-song and compare.

| Engine | What it is | Runs | Control for Claude |
| :- | :- | :- | :- |
| **Synth** | Tone.js, everything synthesized: FM keys, saw pads, membrane drums | Anywhere, also the published page | Full, but every sound is hand-built in the browser |
| **Sampled** | Real recordings via smplr: Wurlitzer, vibraphone, nylon guitar, Mellotron strings, upright bass, LinnDrum | Local page (fetches samples) | Pick and layer instruments; little sound design |
| **Strudel** | Strudel's sound engine (superdough): Salamander piano, folk harp, vibes, hand chimes, an MPC60 kit, effects on every note | Local page (fetches sample banks) | Per-note effects and a big library |
| **SuperCollider** | Native synthesis: Karplus-Strong plucks, modal bells, FM Rhodes, analog-style drums, through your computer's audio | Local page, with SuperCollider installed | The most: synths and effects written as code in `sc/undertone.scd` |

SuperCollider is started by the bridge (`sclang` running `sc/undertone.scd`) the first time you pick it. It boots on your default output device, using an output-only device for input as well, so it never asks macOS for the microphone. If you switch outputs (say, to headphones), stop the bridge and start it again so SuperCollider picks up the new device. Install it with `brew install --cask supercollider` on a Mac; on Windows the bridge finds the newest `C:\Program Files\SuperCollider-*\sclang.exe`. `UNDERTONE_SCLANG` points it anywhere else.

## Ears

undertone can't be heard by Claude directly, so it keeps what you hear in a form Claude can read. On the local page, next to the engine switch:

| Button | Keeps |
| :- | :- |
| **Love this** | The last 20 seconds |
| **This grates** | The last 20 seconds |
| **Snapshot** | The last 30 seconds |

Each one lands in `~/.undertone/ear/<date>/<time>-<engine>-<kind>/`:

| File | What it is |
| :- | :- |
| `clip.wav` | The audio: the page records it on the audio thread, so a busy page can't drop any (SuperCollider keeps a rolling 30 seconds of its own output and hands it over) |
| `spectrogram.png` | 30 Hz at the bottom to 16 kHz at the top; faint lines at 100 Hz, 1 kHz, 10 kHz and every 5 s; a loudness strip underneath with red ticks at clicks |
| `stats.json` | RMS and peak, clipping, clicks per minute, energy per band (sub, bass, low-mid, mid, presence, air), brightness |
| `state.json` | What was playing: engine, mood, key, chord, tempo, texture, every lane |
| `events.json` | The session events around the clip |
| `critique.md` | What Gemini heard, when a key is set (below) |

`~/.undertone/ear/index.jsonl` lists every clip, so reactions can be compared over time. The analysis has no dependencies (`ear/analyze.mjs`).

### Gemini as a second pair of ears

With a Gemini API key, every clip is sent to Gemini, which writes `critique.md`: the vibe, each element, problems, and the three changes that would help most. It listens blind (no measurements), so it's an independent second opinion. Only the audio and musical facts go to Google, never project names; a reaction's note only with `UNDERTONE_GEMINI_NOTE=1`. Get a key at [Google AI Studio](https://aistudio.google.com/apikey), copy it, and save it without pasting it anywhere else:

```bash
mkdir -p ~/.config/undertone && pbpaste > ~/.config/undertone/gemini.key && chmod 600 ~/.config/undertone/gemini.key
```

`GEMINI_API_KEY` works too. `UNDERTONE_GEMINI_MODEL` picks the model (default `gemini-flash-latest`). To critique an older clip: `node ear/gemini.mjs <clip folder>`.

## Your phone

When a session has had a permission prompt waiting for a minute (or has sat idle for five), the bridge pings your phone through [ntfy](https://ntfy.sh): a free app with no account. Anything the session does first cancels the ping, so at your desk you only hear the call. Setup is `~/.config/undertone/ntfy.json` (`chmod 600`):

```json
{ "server": "https://ntfy.sh", "topic": "undertone-<random>", "names": "project", "permissionAfterSec": 60, "idleAfterSec": 300 }
```

| Field | Default | |
| :- | :- | :- |
| `server` | `https://ntfy.sh` | Must be https (plain http only on localhost) |
| `topic` | | At least 16 characters unless you set a token |
| `token` | | An ntfy access token, sent as `Authorization: Bearer`; or `UNDERTONE_NTFY_TOKEN` |
| `names` | `project` | What the ping says: `full` (project · worktree), `project`, or `none` ("A session needs your OK") |
| `enabled` | `true` | `false` turns pings off without deleting the file (say, when another app owns phone pushes) |
| `permissionAfterSec`, `idleAfterSec` | 60, 300 | How long a session waits before your phone hears about it |

What leaves the machine: a title (that name plus "needs your OK" or "is waiting for you"), a fixed message, a priority and a tag, sent to `server` as JSON. Never code, prompts or anything else from the session. On the public ntfy.sh, the topic is the only protection without a token: anyone who knows it can read your pings and send fake ones, and ntfy.sh keeps messages for about 12 hours. A reserved topic with a token, or your own ntfy server, closes that.

Only Claude Code sessions the bridge has heard start (or heartbeat) can ping, never outside sources; a scheduled run pings only for a permission prompt that blocks it. At most one ping per session every 15 minutes and 12 an hour; the rest are dropped and counted. The bridge refuses to send, and says why in `/health` under `notify`, when `server` isn't https, the topic is short with no token, or the file can be read by other users. Install ntfy on the phone, subscribe to the topic, and `curl -X POST http://127.0.0.1:4747/notify/test` sends a test.

To open the page itself on the phone, put the Mac and the phone on one [Tailscale](https://tailscale.com) network, run `tailscale serve --bg 4747` on the Mac, and name the address it prints in `~/.config/undertone/hosts.json`: `{ "hosts": ["your-mac.your-tailnet.ts.net"] }`. The bridge then answers that name too (read fresh, no restart), and the page it serves there is live, not the demo. Only your tailnet's devices reach that address. Synth and Sampled play on the phone; SuperCollider plays on the Mac.

## Sources beyond Claude

Anything can post events to the bridge. An outside source marks its events with `origin` (and its lane id starts with `src-`), which gives it a lane of its own that colors the music but never leads it, never calls you and never pings your phone: a `pulse` event (`count` things happened) plays that many soft notes (high chimes, or another register with `kind`), and `fail` / `pass` with a `check` hold and release the sour note.

`sources/azure-metrics.mjs` turns Azure Monitor metrics into a source: counts per minute (requests, model calls, errors), never logs or traces, so nothing a user typed can come through. Production errors fail as check `prod-errors:<metric>`. Describe sources in `~/.config/undertone/sources.json` (format at the top of the file) and log in with `az login`; the bridge runs them itself while that file describes any, restarts them when you change it, and stops them with it, so `npm start` is the only window. `/health` says under `sources` whether they're running and their last line of output. Give each metric a `kind` to tell them apart by ear (ourPlace plays chats as high `chime`s and site requests as low `read` notes); the lane's chip counts each one. `npm run sources` runs them by hand instead (only one copy runs at a time), and `npm run sources:mock` plays made-up chatbot traffic, to hear it before anything is wired. On Windows `az` is `az.cmd`, which runs through `cmd.exe`, so the source refuses any argument that isn't plain (letters, digits, `/ _ . : + , = -`). Azure publishes each minute's numbers late, so the lane trails real time by about three minutes.

`sources/github-actions.mjs` plays a repository's GitHub Actions: builds starting are soft notes, a green finish a chime, and each workflow's newest finished run on the watched branch decides its check, `ci:<workflow>` ("CI (Deploy to GitHub Pages)"), red until a green run clears it. Cancelled and skipped runs decide nothing. Only workflow names, outcomes and counts reach the bridge, never commit messages, branch names or who pushed. It asks the GitHub CLI (`gh`, logged in) once a minute. An entry with `github` in the same `sources.json`: `{ "jobsnearme-ci": { "github": "coterboat/jobsnearme", "project": "jobsnearme", "label": "jobsnearme CI" } }`, with `branch` to watch another branch than the default. A configured source keeps the bridge up (it doesn't leave after a quiet hour), so its builds are heard when they finish.

## State

`GET http://127.0.0.1:4747/state` answers with every session as the bridge sees it, for the page and anything else (a dashboard) that wants it:

```json
{ "ok": true, "at": 1791050000000, "waitingBy": { "jobsnearme": 4 },
  "lanes": [{ "lane": "a1b2c3d4", "project": "jobsnearme", "label": "jobsnearme · lane-2",
              "state": "needs_ok", "needsReason": "permission", "needsSince": 1791049940000,
              "failing": { "test:vitest": 1791049000000 }, "failingChecks": ["test:vitest"],
              "checklist": { "done": 3, "total": 6 }, "scheduled": false, "external": false,
              "known": true, "openedAt": 1791040000000, "last": 1791049990000, "lastWork": 1791049900000 }] }
```

`state` is `working`, `needs_ok` (a permission prompt), `your_move` (a turn ended, or Claude sat idle: `needsReason` says which) or `idle` (no work for 15 minutes). A session silent for three minutes is gone. The same picture comes first on `/events`, so a reloaded page keeps pending calls and broken builds, and the bridge rebuilds it from the logs when it restarts. The logic lives in `lib/lanes.mjs`, shared by the bridge and the page.

## Timesheets

```bash
npm run week
```

The last 7 days (`npm run week 14` for more, `--json` for the numbers) per project, across every machine that syncs coter-kit's brain:

| Column | What it is |
| :- | :- |
| per day, total | Hours Claude worked on the project (wall clock: parallel sessions count once) |
| parallel | The same hours summed over sessions: three lanes for an hour is 3 |
| blocked | Time sessions sat on a permission prompt, each wait counted up to an hour |
| broken | Time a check (tests, typecheck, lint, build) stayed failing |
| commits | Commits made |

Outside sources get their own line: their totals (chats, requests) and how long their errors lasted.

Each machine's bridge boils its own log down to a small summary per day (`lib/summary.mjs`, a few hundred bytes) and writes it into the brain at `undertone/<device>/<date>.json` every 30 minutes; coter-kit's next sync carries it to your other machines. Raw logs never leave the machine. `GET /timesheet?days=7` serves the same numbers as JSON for a dashboard. The summary is shaped like a database row, so a real database can take over the day home needs queries over months.

## Event log

The bridge appends every event to `~/.undertone/log/<date>.jsonl`: session starts and heartbeats, prompts, turns, tool calls, commits, failing and passing checks by name, calls for you. It's the raw material for metrics such as time per project, time Claude spent waiting on you, and how long builds stayed broken.

Nothing expires by default: the clips are what teaches Claude to hear, and the logs (up to about half a megabyte on a busy day) are your history. `UNDERTONE_EAR_DAYS` and `UNDERTONE_LOG_DAYS` delete clip days and logs older than that many days, on start and daily; pruned clips stay in `ear/index.jsonl`, marked `"pruned": true`.

## Projects

The **Projects** panel lists every project with a running session or questions waiting on you. Untick one to silence it: its sessions stop playing, its broken builds and open questions drop out of the mix. The lead project sets the key and tempo; **Auto** follows the busiest project of the last three minutes and holds still when everything is quiet. Each project can keep its own mood (jobsnearme defaults to bright D major, ourPlace to a warm E♭, Iron Veil to D minor with war drums, wallstbets to A dorian with a ticking hat, undertone and coter-kit to Blue hour, home to Afterhours, anything else to F major). The page remembers your picks.

A mood can also be a **style**: a band and a groove of its own, not just a key. **Blue hour** is the first, a jazz-hop trio in B♭: ii-V-I-VI chords, swung eighths, a walking bass that walks when anyone's busy and drops to half notes when it's quiet, a ride with a cross-stick on 2 and 4, and rootless piano comping (a Rhodes on Sampled, an FM electric piano on Synth) on a different rhythm each bar. **Afterhours** is house in G minor at 123: four on the floor, a clap on 2 and 4, open hats and the bass on every off-beat, chord stabs, and the pad side-chained to the kick. Pick any project's mood in the Projects panel. Everything that tells you something (each session's call, the sour notes, the asks) sounds the same in every style.

## How it fits together

```
Claude Code session ──(mod: hooks/register.js)──▶ bridge (127.0.0.1:4747) ──SSE──▶ page (web/index.html): the conductor
Claude Code session ──┘                              │                                 │
coter-kit's brain (open questions) ─────────────────┘                                 ├─▶ Synth / Sampled / Strudel (in the page)
                                                     bridge ◀── notes ─────────────────┘
                                                        └──OSC──▶ SuperCollider (sc/undertone.scd)
```

| Part | What it is |
| :- | :- |
| `hooks/register.js` | The mod, a plugin of function hooks like coter-kit. It turns session events into small JSON events, sends a heartbeat every minute, and counts coter-kit's open questions per project. |
| `hooks/commands.js` | Reads a Bash command for commits, pushes and which checks ran, and whether its exit code is theirs (not through `\| tail`, `\|\| true`, `;` or `&`). |
| `hooks/waiting.js` | Counts coter-kit's open questions per project, each question once. |
| `lib/lanes.mjs` | Every session's state, shared by the bridge and the page. |
| `lib/summary.mjs`, `bridge/timesheets.mjs` | A day of events boiled down to a summary; summaries written to and read from the brain. |
| `bridge/server.mjs` | A zero-dependency Node server on 127.0.0.1. It serves the page and `/state`, relays events over server-sent events, pings your phone, and talks OSC to SuperCollider. |
| `bridge/launch.mjs` | Starts the bridge detached, the same way on macOS and Windows. |
| `web/index.html` | The conductor and the score. The same file is published as a claude.ai artifact, where it runs the demo on the Synth engine. |
| `web/engines/*.js` | The engines. Each takes the same calls (`pad`, `bass`, `voice`, `drum`, `bell`, `sour`, `drone`, `texture`, `energy`); `common.js` describes them. |
| `sc/undertone.scd` | SuperCollider's synths, effects and OSC handlers. |
| `ear/analyze.mjs`, `ear/gemini.mjs` | The ears: clip analysis and spectrograms, and Gemini's critique. |
| `sources/azure-metrics.mjs` | An outside source: Azure Monitor metrics as a lane. |
| `bridge/sources.mjs` | Runs the outside sources as the bridge's child while `sources.json` describes any. |
| `tests/undertone.test.ts` | Mod tests: `claude plugin test .` |
| `tests/unit/`, `tests/bridge/` | The pure modules, and the bridge run for real: `npm test` |

## coter-kit

undertone is a sibling mod: it never touches coter-kit's code. It hears coter-kit's `checklist` and `remember` calls, its checks' stop blocks, and reads the brain's journal (`~/.claude/coter-brain`, or the `brainDir` setting) the way coter-kit does to count what's waiting on you. It's listed in coter-kit's marketplace, so it installs alongside it:

```bash
claude plugin install undertone@coter-kit
```

## Privacy and security

What leaves the session, to the local bridge: event types, tool names (an MCP tool's server prefix stripped), check names (`test`, `typecheck`, `lint`, `build`, `checks`, with a tool such as `vitest`), project and worktree folder names, counts, and whether the session is a scheduled run. Never prompt text, file paths, command lines or the questions themselves.

What leaves the machine:

| To | What | When |
| :- | :- | :- |
| Your ntfy server (ntfy.sh by default) | A ping's title (per `names`), a fixed message, priority and tag | A session waits on you (see Your phone) |
| Your brain repo (coter-kit's, private on GitHub) | Each day's summary per project: minutes worked, blocked and broken, counts of sessions, turns, commits and pushes, first and last time of work; outside sources' totals | Written every 30 minutes, carried by coter-kit's sync |
| Google (Gemini) | A clip's audio, engine, mood, key, tempo, texture level, reaction kind; its note only with `UNDERTONE_GEMINI_NOTE=1` | You press Love this, This grates or Snapshot, with a Gemini key set |
| Nowhere else | Outside sources run locally: Azure is read through your own `az` CLI, and only counts reach the bridge | |

The bridge listens on 127.0.0.1 only and answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`, or to a name you list in `hosts.json` (anything else gets 421), so a web page can't reach it through DNS rebinding. Posts from another origin get 403 (a listed name takes posts only from its own `https://` page), and posts need a JSON content type. It keeps only the fields the page reads.

## Commands

| Command | What it does |
| :- | :- |
| `/undertone` | Start the bridge if needed and open the page |
| `/undertone status` | Is the bridge up, and is this session sending |
| `/undertone off`, `/undertone on` | Stop or resume sending this session's events |
| `/undertone stop` | Stop the bridge; no session starts it again until `/undertone` or `npm start` |

The bridge is simply there. The first session starts it (`bridge/launch.mjs`) detached, so it belongs to no session and no window, with its output in `~/.undertone/bridge.log`. It leaves after an hour with no Claude Code session, no page open and no outside source to record (so on a machine with sources it stays up, and overnight traffic still reaches the timesheet); the next session starts it again. While no bridge answers, a session keeps up to 500 events or 5 minutes of them and tries to start one at most once a minute. `/undertone stop` stops it on purpose: a marker (`~/.undertone/stopped`) keeps sessions from starting it until `/undertone` or `npm start`. A bridge you start yourself with `npm start` never leaves on its own. Set `bridge` to `manual` and sessions never start it. Phone pings stop while no bridge runs.

## Settings

| Setting | Default | |
| :- | :- | :- |
| `port` | 4747 | The bridge's port on 127.0.0.1 |
| `brainDir` | `~/.claude/coter-brain` | Where coter-kit's brain lives |
| `bridge` | `auto` | `auto`: the first session starts the bridge; `manual`: only `/undertone` or `npm start` does |

The bridge reads these from its environment:

| Variable | |
| :- | :- |
| `UNDERTONE_PORT` | The port, when not given as an argument |
| `UNDERTONE_HOME` | Where logs and clips go (default `~/.undertone`) |
| `UNDERTONE_IDLE_EXIT_MIN` | Quiet minutes before the bridge leaves (default 60 when a session started it, 0 (never) when you did) |
| `UNDERTONE_BRAIN_DIR` | coter-kit's brain, where daily summaries go (default `~/.claude/coter-brain`) |
| `UNDERTONE_EAR_DAYS`, `UNDERTONE_LOG_DAYS` | Delete clips and logs older than this (default 0: keep) |
| `UNDERTONE_NTFY_TOKEN` | An ntfy access token |
| `UNDERTONE_SCLANG` | Where SuperCollider's `sclang` is |
| `UNDERTONE_SOURCES`, `UNDERTONE_SOURCES_CONFIG` | `0` stops the bridge running outside sources; where `sources.json` is |
| `GEMINI_API_KEY`, `UNDERTONE_GEMINI_MODEL`, `UNDERTONE_GEMINI_NOTE` | Gemini's key (or `~/.config/undertone/gemini.key`), model, and whether notes go too |
