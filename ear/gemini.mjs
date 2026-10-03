// Gemini as undertone's second pair of ears: it listens to a saved clip and writes what it
// hears to critique.md beside it, the way Grok reviews code. Claude reads that, plus the
// spectrogram and stats, and tunes the engines.
//
// The key comes from GEMINI_API_KEY or ~/.config/undertone/gemini.key (a file with just the
// key; chmod 600). Only the audio and musical facts go to Google: no project names.
//
//   node ear/gemini.mjs <clip folder>     critique one clip by hand

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY_FILE = path.join(os.homedir(), '.config', 'undertone', 'gemini.key')
// Tried in order: a busy model (503/429) is retried with backoff, a missing one (404) skipped
const MODELS = [...new Set([process.env.UNDERTONE_GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-pro-latest'].filter(Boolean))]
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim()
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return '' }
}

const VERDICT = { love: 'They pressed "Love this".', grates: 'They pressed "This grates".', snapshot: 'They took a neutral snapshot.' }

export function promptFor(meta, stats) {
  const s = meta.state || {}
  return [
    'You are the ears for undertone, a generative music system that plays a developer\'s live coding sessions as',
    'background music they listen to for hours while they work: lofi and downtempo, with sounds that mean things',
    '(a held dissonant note means a build is broken, a rising three-note call means a session needs them, a low drone',
    'means questions are waiting on them, a bell arpeggio means a commit).',
    '',
    `This clip is ${stats.seconds} seconds from the "${s.engine || 'unknown'}" engine, mood "${s.moodName || s.mood || '?'}" ` +
      `(${s.key || '?'}, ${s.bpm || '?'} bpm), tape/vinyl texture at ${Math.round((s.texture ?? 0) * 100)}%. ` + (VERDICT[meta.kind] || ''),
    meta.note ? `Their note: "${meta.note}"` : '',
    '',
    // No measurements on purpose: Claude already has those, so this stays an independent second opinion
    'Judge only by ear. Answer like a mix engineer and producer, specific and blunt, no praise padding:',
    '1. The overall vibe, and whether it works as all-day background music.',
    '2. Each element you can pick out (pads, bass, keys, plucks, mallets, drums, bells, any held dissonant note, drone, tape or vinyl noise) and how it sounds.',
    '3. Problems: harshness, mud, clicks, crackle or distortion, anything too loud or buried, repetitiveness, timing.',
    '4. The three changes that would most improve it, most important first.',
  ].filter(Boolean).join('\n')
}

async function ask(key, model, body) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, ok: r.ok, j }
}

export async function critique(dir, { key = geminiKey(), models = MODELS } = {}) {
  if (!key) throw new Error('no Gemini key: set GEMINI_API_KEY or put it in ' + KEY_FILE)
  const wav = fs.readFileSync(path.join(dir, 'clip.wav'))
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'))
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))
  const body = {
    contents: [{ role: 'user', parts: [{ text: promptFor(meta, stats) }, { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } }] }],
  }
  const tried = []
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { status, ok, j } = await ask(key, model, body)
      if (ok) {
        const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text).filter(Boolean).join('\n')
        if (!text) throw new Error('Gemini (' + model + ') returned no text')
        fs.writeFileSync(path.join(dir, 'critique.md'), '# What Gemini heard (' + model + ')\n\n' + text.trim() + '\n')
        return text
      }
      tried.push(model + ' ' + status)
      if (status === 503 || status === 429 || status === 500) { await wait(2000 * 2 ** attempt); continue }
      if (status === 404 || status === 400) break
      throw new Error('Gemini answered ' + status + ': ' + ((j.error && j.error.message) || 'no detail'))
    }
  }
  throw new Error('Gemini was busy or unavailable: ' + tried.join(', '))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node ear/gemini.mjs <clip folder>'); process.exit(2) }
  critique(path.resolve(dir)).then((t) => console.log(t)).catch((err) => { console.error(err.message); process.exit(1) })
}
