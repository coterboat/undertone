# undertone

Your Claude Code sessions, played as music. Each session is a voice, every tool call is a note, a commit resolves the chord, and a broken build holds a sour note until it's green.

It's generative lofi/downtempo, synthesized live in the browser with [Tone.js](https://tonejs.github.io/). There are no samples and nothing to install beyond Node.

## Quick start

```bash
npm start
```

Then open http://127.0.0.1:4747 and press Play. With the mod installed, every Claude Code session shows up as a lane. Without it, turn on **Demo sessions** or use the jam deck.

From inside Claude Code, `/undertone` does the same thing: it starts the bridge if it isn't running and opens the page.

## How it fits together

```
Claude Code session ──(mod: hooks/register.js)──▶ bridge (127.0.0.1:4747) ──SSE──▶ page (web/index.html)
Claude Code session ──┘                                                            Tone.js synths + score
```

| Part | What it is |
| :- | :- |
| `hooks/register.js` | The mod, a plugin of function hooks like coter-kit. It turns session events into small JSON events and posts them to the bridge. |
| `bridge/server.mjs` | A zero-dependency Node server on 127.0.0.1. It serves the page and relays events to it over server-sent events. |
| `web/index.html` | The music engine and the score. The same file is published as a claude.ai artifact, where it runs the demo. |
| `tests/undertone.test.ts` | Mod tests; run them with `claude plugin test .` |

## What you hear

| Event | Comes from | Sound |
| :- | :- | :- |
| A session starts | session start | A new voice joins: keys, pluck, mallet, cello in arrival order. A worktree plays as `project · worktree`. |
| Tool call | every tool call | A note in that voice. Reads sit low, edits land on chord tones, commands ride high. |
| Prompt | you send a message | A three-note pickup |
| Claude is working | turn start / end | Drums fade in; all quiet thins back to pads and tape hiss |
| Commit / push | `git commit` / `git push` in Bash | The progression resolves to the home chord, with a bell |
| Build breaks | a failing test, build, typecheck or lint command; coter-kit's checks blocking a stop | A sour tritone holds over every chord |
| Build fixed | the same kind of check passing | The sour note slides into the chord |
| Checklist step | coter-kit's `checklist` tool | A bell climbs a step; a finished list lands home |
| Waiting on you | coter-kit's `waiting` notes | A low drone that grows with each open question |

The mood follows the busiest project: jobsnearme plays in D major, ourPlace in a warm E♭, Iron Veil in D minor with war drums, wallstbets in A dorian with a ticking hat, everything else in F major. Pick one by hand under **Mix**.

## coter-kit

undertone is a sibling mod, not part of coter-kit, so it never touches coter-kit's code. It listens for coter-kit's `checklist` and `remember` tool calls and its checks' stop blocks. Whether it sees them depends on the plugin order: coter-kit answers its own tools without passing them on, so undertone has to load above it.

## Privacy

Only event types, tool names (an MCP tool's server prefix stripped) and the project's folder name leave the session. Prompt text, file paths and command lines never do. The bridge listens on 127.0.0.1 only, keeps only the fields the page reads, and refuses posts without a JSON content type, so a web page can't post to it without a CORS preflight it never answers.

## Commands

| Command | What it does |
| :- | :- |
| `/undertone` | Start the bridge if needed and open the page |
| `/undertone status` | Is the bridge up, and is this session sending |
| `/undertone off`, `/undertone on` | Stop or resume sending this session's events |
| `/undertone stop` | Stop the bridge, if this session started it |

A bridge started by `/undertone` lives as long as that session. For one that outlives sessions, run `npm start` in a terminal.

## Install the mod

```bash
claude plugin marketplace add coterboat/undertone
```

```bash
claude plugin install undertone@undertone
```

The bridge port is the plugin's `port` setting (default 4747).
