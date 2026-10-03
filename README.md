# undertone

Your Claude Code sessions, played as music, and a way for them to tell you what needs you without you looking. Each session is a voice with its own three-note call, every tool call is a note, a commit resolves the chord, a broken build holds a sour note, and every question waiting on you hums underneath until you answer.

## Quick start

```bash
npm start
```

Then open http://127.0.0.1:4747 and press Play. From inside Claude Code, `/undertone` does the same thing: it starts the bridge if it isn't running and opens the page.

## What needs you, by ear

| You hear | It means |
| :- | :- |
| A session's call ending on a rising, held note | That session needs you. A permission prompt asks again every minute (three times at most); an idle session asks once |
| A session's call settling on the chord's root | That session finished its turn: your move |
| A low drone that grows | Questions waiting on you, counted from coter-kit's `waiting` notes in every project you have on |
| A sour, trembling tritone over every chord | A build is broken: a failing test, build, typecheck or lint, or coter-kit's checks blocking a stop |

A call comes from the project and worktree, not the session, so `jobsnearme · oct2-signup` sounds the same every time it starts and you learn who's calling. The ending carries the meaning: settled means done, rising means it needs you. Everything else is texture: tool calls are notes in the session's voice (reads low, edits on chord tones, commands high), drums fade in while Claude works, a commit resolves the progression home with a bell, a checklist step climbs a bell, and a fixed build slides the sour note into the chord.

## Sound engines

Pick one at the top of the page. The page conducts in every case (harmony, timing, who plays what), so you can switch mid-song and compare.

| Engine | What it is | Runs | Control for Claude |
| :- | :- | :- | :- |
| **Synth** | Tone.js, everything synthesized: FM keys, saw pads, membrane drums | Anywhere, also the published page | Full, but every sound is hand-built in the browser |
| **Sampled** | Real recordings via smplr: Wurlitzer, vibraphone, nylon guitar, Mellotron strings, upright bass, LinnDrum | Local page (fetches samples) | Pick and layer instruments; little sound design |
| **Strudel** | Strudel's sound engine (superdough): Salamander piano, VCSL kalimba, vibes, harp, an MPC60 kit, effects on every note | Local page (fetches sample banks) | Per-note effects and a big library |
| **SuperCollider** | Native synthesis: Karplus-Strong plucks, modal bells, FM Rhodes, analog-style drums, through your computer's audio | Local page, with SuperCollider installed | The most: synths and effects written as code in `sc/undertone.scd` |

SuperCollider is started by the bridge (`sclang` running `sc/undertone.scd`) the first time you pick it. It boots on your default output device, using an output-only device for input as well, so it never asks macOS for the microphone. If you switch outputs (say, to headphones), stop the bridge and start it again so SuperCollider picks up the new device. Install it with `brew install --cask supercollider`.

## Ears

undertone can't be heard by Claude directly, so it keeps what you hear in a form Claude can read. On the local page, under the engine cards:

| Button | Keeps |
| :- | :- |
| **Love this** | The last 20 seconds |
| **This grates** | The last 20 seconds |
| **Snapshot** | The last 30 seconds |

Each one lands in `~/.undertone/ear/<date>/<time>-<engine>-<kind>/`:

| File | What it is |
| :- | :- |
| `clip.wav` | The audio (SuperCollider keeps a rolling 30 seconds of its own output and hands it over) |
| `spectrogram.png` | 30 Hz at the bottom to 16 kHz at the top; faint lines at 100 Hz, 1 kHz, 10 kHz and every 5 s; a loudness strip underneath with red ticks at clicks |
| `stats.json` | RMS and peak, clipping, clicks per minute, energy per band (sub, bass, low-mid, mid, presence, air), brightness |
| `state.json` | What was playing: engine, mood, key, chord, tempo, texture, every lane |
| `events.json` | The session events around the clip |
| `critique.md` | What Gemini heard, when a key is set (below) |

`~/.undertone/ear/index.jsonl` lists every clip, so reactions can be compared over time. The analysis has no dependencies (`ear/analyze.mjs`).

### Gemini as a second pair of ears

With a Gemini API key, every clip is sent to Gemini, which writes `critique.md`: the vibe, each element, problems, and the three changes that would help most. Only the audio and musical facts go to Google, never project names. Get a key at [Google AI Studio](https://aistudio.google.com/apikey), copy it, and save it without pasting it anywhere else:

```bash
mkdir -p ~/.config/undertone && pbpaste > ~/.config/undertone/gemini.key && chmod 600 ~/.config/undertone/gemini.key
```

`GEMINI_API_KEY` works too. `UNDERTONE_GEMINI_MODEL` picks the model (default `gemini-flash-latest`). To critique an older clip: `node ear/gemini.mjs <clip folder>`.

## Your phone

When a session has had a permission prompt waiting for a minute (or has sat idle for five), the bridge pings your phone through [ntfy](https://ntfy.sh): a free app with no account. Anything the session does first cancels the ping, so at your desk you only hear the call. Setup is `~/.config/undertone/ntfy.json`:

```json
{ "server": "https://ntfy.sh", "topic": "undertone-<random>", "permissionAfterSec": 60, "idleAfterSec": 300 }
```

On ntfy.sh a topic is private only because nobody can guess it, so keep it random. A ping carries the lane's name (project and worktree), never code or prompts. Install ntfy on the phone and subscribe to the topic. `curl -X POST http://127.0.0.1:4747/notify/test` sends a test.

## Sources beyond Claude

Anything can post events to the bridge. An outside source gets a lane of its own that colors the music but never leads it: a `pulse` event (`count` things happened) plays that many soft high notes, and `fail` / `pass` hold and release the sour note.

`sources/azure-metrics.mjs` turns Azure Monitor metrics into a source: counts per minute (requests, model calls, errors), never logs or traces, so nothing a user typed can come through. Describe sources in `~/.config/undertone/sources.json` (format at the top of the file), log in with `az login`, then run `npm run sources`. `npm run sources:mock` plays made-up chatbot traffic, to hear it before anything is wired. Azure publishes each minute's numbers late, so the lane trails real time by about three minutes.

## Event log

The bridge appends every event to `~/.undertone/log/<date>.jsonl`: session starts and heartbeats, prompts, turns, tool calls, commits, failing and passing checks, calls for you. It's the raw material for metrics such as time per project, time Claude spent waiting on you, and how long builds stayed broken.

## Projects

The **Projects** panel lists every project with a running session or questions waiting on you. Untick one to silence it: its sessions stop playing, its broken builds and open questions drop out of the mix. The lead project sets the key and tempo; **Auto** follows the busiest project of the last three minutes and holds still when everything is quiet. Each project can keep its own mood (jobsnearme defaults to bright D major, ourPlace to a warm E♭, Iron Veil to D minor with war drums, wallstbets to A dorian with a ticking hat, anything else to F major). The page remembers your picks.

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
| `bridge/server.mjs` | A zero-dependency Node server on 127.0.0.1. It serves the page, relays events over server-sent events, drops sessions silent for three minutes, and talks OSC to SuperCollider. |
| `web/index.html` | The conductor and the score. The same file is published as a claude.ai artifact, where it runs the demo on the Synth engine. |
| `web/engines/*.js` | The engines. Each takes the same calls (`pad`, `bass`, `voice`, `drum`, `bell`, `sour`, `drone`, `texture`, `energy`); `common.js` describes them. |
| `sc/undertone.scd` | SuperCollider's synths, effects and OSC handlers. |
| `ear/analyze.mjs`, `ear/gemini.mjs` | The ears: clip analysis and spectrograms, and Gemini's critique. |
| `sources/azure-metrics.mjs` | An outside source: Azure Monitor metrics as a lane. |
| `tests/undertone.test.ts` | Mod tests; run them with `claude plugin test .` |

## coter-kit

undertone is a sibling mod: it never touches coter-kit's code. It hears coter-kit's `checklist` and `remember` calls, its checks' stop blocks, and reads the brain's journal (`~/.claude/coter-brain`, or the `brainDir` setting) the way coter-kit does to count what's waiting on you. It's listed in coter-kit's marketplace, so it installs alongside it:

```bash
claude plugin install undertone@coter-kit
```

## Privacy

Event types, tool names (an MCP tool's server prefix stripped), project folder names and the number of open questions per project leave the session. Prompt text, file paths, command lines and the questions themselves never do. The bridge listens on 127.0.0.1 only, keeps only the fields the page reads, and refuses posts without a JSON content type, so a web page can't post to it without a CORS preflight it never answers.

## Commands

| Command | What it does |
| :- | :- |
| `/undertone` | Start the bridge if needed and open the page |
| `/undertone status` | Is the bridge up, and is this session sending |
| `/undertone off`, `/undertone on` | Stop or resume sending this session's events |
| `/undertone stop` | Stop the bridge, if this session started it |

A bridge started by `/undertone` lives as long as that session. For one that outlives sessions, run `npm start` in a terminal.

## Settings

| Setting | Default | |
| :- | :- | :- |
| `port` | 4747 | The bridge's port on 127.0.0.1 |
| `brainDir` | `~/.claude/coter-brain` | Where coter-kit's brain lives |
