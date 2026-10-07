// Strudel: the sound engine behind strudel.cc (superdough), played note by note. The Salamander
// grand piano, VCSL kalimba, vibes, harp and glockenspiel, an MPC60 kit, and per-note effects
// (room, echo, filter). Sample banks load from GitHub, so it runs on the local page only.
// Some VCSL instruments are left out on purpose: the kalimba's files fail to download and the
// harp and glockenspiel recordings sit 20-30 dB under everything else.

// Strudel's output is one shared node. Only the newest instance may wire it, and only the
// instance that wired it may unwire it, so a stale instance can't silence the live one.
let strudelOwner = null
let strudelGen = 0
// The library, its audio and its sample banks load once per page
let strudelBoot = null

window.UndertoneEngines.add({
  id: 'strudel',
  label: 'Strudel',
  blurb: 'Strudel’s sound engine: Salamander piano, folk harp, vibes, hand chimes, an MPC60 kit, effects on every note.',
  local: true,
  create() {
    const { makeFx, makeTexture, makeDrone, makeSour } = window.UndertoneEngines.kit
    const STRUDEL = 'https://cdn.jsdelivr.net/npm/@strudel/web@1.3.0/dist/index.mjs'
    const DOUGH = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/'
    let st, io, fx, texture, drone, sour, sounds = new Set(), kit = 'akailinn', cutoff = 1000
    const has = (s) => sounds.has(s)
    // "A4", "c#5", "Bb2" -> MIDI note number
    const midiOf = (name) => {
      const m = /^([a-g])([#b]?)(-?\d)$/i.exec(name)
      if (!m) return null
      const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
      return 12 * (Number(m[3]) + 1) + pc
    }
    const first = (...names) => names.find(has) || names[names.length - 1]
    let SND = {}
    const me = { gen: ++strudelGen }

    // superdough takes a value object, an AudioContext time and a duration
    function play(value, time, dur) {
      if (time < io.ctx.currentTime) return
      st.superdough(value, time, dur).catch(() => {})
    }

    return {
      async init(ioIn) {
        io = ioIn
        io.status('Loading Strudel')
        strudelBoot = strudelBoot || (async () => {
          const lib = await import(STRUDEL)
          lib.setAudioContext(io.ctx)
          await lib.initStrudel()
          await lib.initAudio().catch(() => {})
          await Promise.all(['piano.json', 'vcsl.json', 'tidal-drum-machines.json'].map((f) => lib.samples(DOUGH + f)))
          return lib
        })()
        st = await strudelBoot
        sounds = new Set(Object.keys(st.soundMap.get()))
        kit = ['akaimpc60', 'akailinn', 'linndrum'].find((k) => has(k + '_bd') && has(k + '_sd') && has(k + '_hh')) || 'akailinn'
        SND = {
          keys: first('piano'),
          pluck: first('folkharp', 'harp'),
          mallet: first('vibraphone_soft', 'vibraphone', 'marimba'),
          bell: first('handchimes', 'glockenspiel', 'triangle'),
          tom: first(kit + '_lt', kit + '_mt', kit + '_bd'),
          rim: first(kit + '_rim', kit + '_cp', kit + '_sd'),
        }

        // Route superdough's output through the page's master instead of straight to the speakers
        if (me.gen !== strudelGen) throw new Error('replaced by a newer start')
        const out = st.getSuperdoughAudioController().output
        out.destinationGain.disconnect()
        out.destinationGain.connect(io.out.input)
        strudelOwner = me

        // Superdough fetches a sample the first time a note needs it, and a note whose sample
        // arrives late is dropped. So fetch every sample of every sound we use now, silently.
        io.status('Loading samples')
        const map = st.soundMap.get()
        const t = io.ctx.currentTime + 0.1
        const loads = []
        for (const s of new Set([SND.keys, SND.pluck, SND.mallet, SND.bell, kit + '_bd', kit + '_sd', kit + '_hh', SND.tom, SND.rim])) {
          const samples = map[s] && map[s].data && map[s].data.samples
          const notes = samples && !Array.isArray(samples) ? Object.keys(samples).map(midiOf).filter((m) => m != null) : [null]
          for (const note of notes) loads.push(st.superdough(note == null ? { s, gain: 0.0001 } : { s, note, gain: 0.0001 }, t, 0.05).catch(() => {}))
        }
        await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 20000))])

        fx = await makeFx(io, { decay: 5 })
        texture = makeTexture(io)
        drone = makeDrone(io, fx.send)
        sour = makeSour(io, fx.send)
        io.status('')
      },
      dispose() {
        if (strudelOwner === me) {
          strudelOwner = null
          try { st.getSuperdoughAudioController().output.destinationGain.disconnect() } catch {}
        }
        for (const x of [fx, texture, drone, sour]) if (x) x.dispose()
      },
      pad(notes, time, dur, vel) {
        notes.forEach((note, i) => play({
          s: 'sawtooth', note, gain: 0.18 * vel, attack: 1.8, decay: 1, sustain: 0.75, release: 3.5,
          lpf: cutoff, lpq: 0.4, room: 0.7, roomsize: 6, pan: 0.3 + (i % 2) * 0.4, orbit: 3,
        }, time, dur))
      },
      bass(note, time, dur, vel) {
        play({ s: 'triangle', note, gain: 0.55 * vel, lpf: 500, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.4, orbit: 4 }, time, dur)
      },
      voice(timbre, note, time, dur, vel) {
        const dot8 = (60 / io.bpm()) * 0.75
        const v = { s: SND[timbre], note, gain: 0.7 * vel, room: 0.35, roomsize: 3, orbit: 1 }
        if (timbre === 'pluck') Object.assign(v, { delay: 0.35, delaytime: dot8, delayfeedback: 0.4 })
        if (timbre === 'keys') Object.assign(v, { lpf: 3500, delay: 0.12, delaytime: dot8, delayfeedback: 0.25 })
        // The low voice is a bowed saw with a slow vibrato rather than a sample
        if (timbre === 'cello') Object.assign(v, { s: 'sawtooth', gain: 0.32 * vel, attack: 0.18, decay: 0.4, sustain: 0.6, release: 1.2, lpf: 1100, vib: 5, vibmod: 0.12, room: 0.55, delay: 0 })
        play(v, time, timbre === 'cello' ? dur : dur * 2)
      },
      drum(kind, time, vel) {
        const s = kind === 'kick' ? kit + '_bd' : kind === 'snare' ? kit + '_sd' : kind === 'hat' ? kit + '_hh' : kind === 'tom' ? SND.tom : SND.rim
        play({ s, gain: 0.4 * vel, lpf: 6500, room: kind === 'tom' ? 0.4 : 0.08, orbit: 2 }, time, 0.3)
      },
      // The same dotted eighth as the voices on its orbit: a fixed 0.375 retuned their shared echo on every bell
      bell(note, time, dur, vel) { play({ s: SND.bell, note, gain: 0.9 * vel, room: 0.6, roomsize: 5, delay: 0.25, delaytime: (60 / io.bpm()) * 0.75, delayfeedback: 0.35, orbit: 1 }, time, dur) },
      sour(state, m, time, to) { sour[state](m, time, to) },
      drone(level, tonic, time) { drone.set(level, tonic, time) },
      texture(a) { texture.set(a) },
      energy(e, time, base) { cutoff = (base || 900) * (0.75 + e * 1.6) },
    }
  },
})
