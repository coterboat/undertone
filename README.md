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

Each session's call comes from its id, so after a while you know who's calling. Everything else is texture: tool calls are notes in the session's voice (reads low, edits on chord tones, commands high), drums fade in while Claude works, a commit resolves the progression home with a bell, a checklist step climbs a bell, and a fixed build slides the sour note into the chord.

## Sound engines

Pick one at the top of the page. The page conducts in every case (harmony, timing, who plays what), so you can switch mid-song and compare.

| Engine | What it is | Runs | Control for Claude |
| :- | :- | :- | :- |
| **Synth** | Tone.js, everything synthesized: FM keys, saw pads, membrane drums | Anywhere, also the published page | Full, but every sound is hand-built in the browser |
| **Sampled** | Real recordings via smplr: Wurlitzer, vibraphone, nylon guitar, Mellotron strings, upright bass, LinnDrum | Local page (fetches samples) | Pick and layer instruments; little sound design |
| **Strudel** | Strudel's sound engine (superdough): Salamander piano, VCSL kalimba, vibes, harp, an MPC60 kit, effects on every note | Local page (fetches sample banks) | Per-note effects and a big library |
| **SuperCollider** | Native synthesis: Karplus-Strong plucks, modal bells, FM Rhodes, analog-style drums, through your computer's audio | Local page, with SuperCollider installed | The most: synths and effects written as code in `sc/undertone.scd` |

SuperCollider is started by the bridge (`sclang` running `sc/undertone.scd`) the first time you pick it. It boots on your default output device, using an output-only device for input as well, so it never asks macOS for the microphone. If you switch outputs (say, to headphones), stop the bridge and start it again so SuperCollider picks up the new device. Install it with `brew install --cask supercollider`.

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
