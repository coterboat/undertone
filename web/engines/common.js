// undertone engines: what every engine shares, and the registry the page reads.
//
// An engine renders what the conductor (index.html) decides. Every method takes times in
// AudioContext seconds on the one shared context; `io.out` is the engine's way into the
// master chain (fade, compressor, limiter, volume).
//
//   init(io)                       io = { ctx, Tone, out, status(text) }; resolves when it can play
//   dispose()
//   pad(notes, time, dur, vel, home)
//   bass(midi, time, dur, vel)
//   voice(timbre, midi, time, dur, vel)    timbre: keys | pluck | mallet | cello
//   drum(kind, time, vel, midi)            kind: kick | snare | hat | tom | rim, and ride | stick where
//                                          drumKinds lists them (the conductor falls back to hat | rim)
//   comp(notes, time, dur, vel)            optional: a short piano chord, for jazz (else a short pad)
//   style(name)                            optional: the conductor's style changed (lofi | jazz | house | farshore | deepfield)
//   layer(name, notes, time, dur, vel)     optional: a style's own part (pulse, accent, tick, ...); false = not mine
//   tier(n)                                optional: 0 calm, 1 working, 2 full
//   bell(midi, time, dur, vel)
//   sour(state, midi, time, to)            state: on | move | off (to = the note it resolves into)
//   drone(level, tonic, time)              level 0..1 (the conductor no longer uses it: waiting questions are asked with bells)
//   texture(amount)                        tape hiss and vinyl, 0..1
//   energy(e, time)                        0..1, how busy the sessions are
//   level(amount)                          only engines that play outside the page (SuperCollider)

(() => {
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)
  const fold = (n, lo, hi) => { while (n < lo) n += 12; while (n > hi) n -= 12; return n }
  // A bus that mixes mono voices with stereo ones that come and go (Tone's noise is stereo) flips
  // between 1 and 2 channels on every hit, and Chrome rebuilds the filters after it with empty
  // state each time: a pop on whatever else is playing through them. Pinned, it never flips.
  const stereo = (node) => { node.channelCount = 2; node.channelCountMode = 'explicit'; return node }

  // A reverb and a dotted-eighth echo, with a helper that wires a source dry plus sends
  async function makeFx(io, { decay = 6.5 } = {}) {
    const { Tone, out } = io
    const verb = new Tone.Reverb({ decay, preDelay: 0.03, wet: 1 })
    await verb.generate()
    verb.connect(out)
    const verbIn = stereo(new Tone.Gain(1)).connect(verb)
    const echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.36, wet: 1 })
    const echoTone = new Tone.Filter(2600, 'lowpass')
    echo.chain(echoTone, out)
    echoTone.connect(new Tone.Gain(0.4).connect(verbIn))
    const echoIn = stereo(new Tone.Gain(1)).connect(echo)
    const nodes = [verb, verbIn, echo, echoTone, echoIn]
    const send = (node, { dry = 1, rv = 0, ec = 0, to = out } = {}) => {
      const parts = [new Tone.Gain(dry)]
      node.connect(parts[0]); parts[0].connect(to)
      if (rv) { const g = new Tone.Gain(rv); node.connect(g); g.connect(verbIn); parts.push(g) }
      if (ec) { const g = new Tone.Gain(ec); node.connect(g); g.connect(echoIn); parts.push(g) }
      nodes.push(...parts)
      return node
    }
    // '8n.' is turned into seconds once, at the tempo playing then; the page calls this each bar
    const tempo = retime(echo)
    return { verbIn, echoIn, send, tempo, dispose: () => nodes.forEach((n) => n.dispose()) }
  }

  // Keeps an echo a dotted eighth at the page's tempo, gliding to a new one over half a second
  function retime(delay) {
    let last = 0
    return (bpm, time) => {
      const t = (60 / bpm) * 0.75
      if (!(t > 0) || Math.abs(t - last) < 1e-4) return
      last = t
      delay.delayTime.rampTo(t, 0.5, time)
    }
  }

  // Tape hiss and vinyl crackle: a generated six-second loop, no samples. Soft by design: the
  // crackle is sparse, every pop is small (a rare loud pop was what read as "too crackly"), and
  // the hiss is filtered so it doesn't sit alone on top of the mix.
  function makeTexture(io) {
    const { Tone, ctx, out } = io
    const sr = ctx.sampleRate
    const len = Math.floor(sr * 6)
    const buf = new Float32Array(len)
    for (let i = 0; i < len; i++) buf[i] = (Math.random() * 2 - 1) * 0.003
    for (let i = Math.floor(sr * 0.05); i < len; i += Math.floor(sr * (0.12 + Math.random() * 0.8))) {
      const amp = Math.random() * 0.05 + 0.012
      const n = Math.floor(sr * 0.0012)
      for (let k = 0; k < n && i + k < len; k++) buf[i + k] += amp * (Math.random() * 2 - 1) * Math.exp(-k / (n * 0.3))
    }
    const player = new Tone.Player(Tone.ToneAudioBuffer.fromArray(buf))
    player.loop = true
    const hp = new Tone.Filter(900, 'highpass')
    const lp = new Tone.Filter(5000, 'lowpass')
    const gain = new Tone.Gain(0)
    player.chain(hp, lp, gain, out)
    player.start()
    return {
      // 0 is silent; 1 is about -24 dB under the music
      set: (a) => gain.gain.rampTo(a <= 0.001 ? 0 : 0.008 + a * 0.035, 0.4),
      dispose: () => [player, hp, lp, gain].forEach((n) => n.dispose()),
    }
  }

  // The waiting-on-you drone: a pedal on the tonic that grows with each open question
  function makeDrone(io, send) {
    const { Tone } = io
    const gain = new Tone.Gain(0)
    const breath = new Tone.Gain(1)
    const lfo = new Tone.LFO({ frequency: 0.06, min: 0.55, max: 1 }).start()
    lfo.connect(breath.gain)
    const lp = new Tone.Filter(900, 'lowpass')
    const oscs = [
      new Tone.Oscillator({ type: 'sine', frequency: 65, volume: -4 }),
      new Tone.Oscillator({ type: 'sine', frequency: 130, detune: -5, volume: -10 }),
      new Tone.Oscillator({ type: 'triangle', frequency: 196, detune: 4, volume: -14 }),
    ]
    for (const o of oscs) { o.connect(lp); o.start() }
    lp.chain(gain, breath)
    send(breath, { dry: 1, rv: 0.5 })
    return {
      set(level, tonic, time) {
        // An octave above the bass: low enough to sit under everything, high enough that laptop
        // speakers play it and it doesn't swamp the sub (measured: at full strength the old one took
        // a third of the mix's energy)
        gain.gain.rampTo(level ? 0.02 + 0.05 * level : 0, 3, time)
        oscs[0].frequency.rampTo(hz(fold(tonic, 38, 49)), 3, time)
        oscs[1].frequency.rampTo(hz(fold(tonic, 50, 61)), 3, time)
        oscs[2].frequency.rampTo(hz(fold(tonic + 7, 50, 61)), 3, time)
      },
      dispose: () => [gain, breath, lfo, lp, ...oscs].forEach((n) => n.dispose()),
    }
  }

  // The sour note: a held, trembling saw that can glide (samples can't, so every engine uses this)
  // Far shore (after Mass Effect 1; docs/space-styles.md), shared by the engines that play in the
  // page so the style sounds the same on each. One dark hall on an aux (40 ms predelay, about 5 s,
  // the return low-passed near 4 kHz), wetter when calm and drier when busy; everything else keeps a dry
  // onset. Each part has its own band: the pulse under 180 Hz, the pad 150-800 Hz, the rest above.
  async function makeFarShore(io) {
    const { Tone, out } = io
    const nodes = []
    const keep = (n) => (nodes.push(n), n)
    const hall = keep(new Tone.Reverb({ decay: 5, preDelay: 0.04, wet: 1 }))
    await hall.generate()
    // About 4 dB up: measured 5 dB under the other styles, so a switch would duck the volume
    const level = keep(stereo(new Tone.Gain(1.6)))
    level.connect(out)
    const hallIn = keep(stereo(new Tone.Gain(0.3)))
    hallIn.chain(hall, keep(new Tone.Filter(4000, 'lowpass')), level)
    const dry = keep(stereo(new Tone.Gain(1)))
    dry.connect(level)
    const route = (node, send) => {
      node.connect(dry)
      if (send) { const g = keep(new Tone.Gain(send)); node.connect(g); g.connect(hallIn) } // (connect returns the source, not the target)
    }

    // The pad: two saws 7 cents either side, 150-800 Hz, slow in and out; it gives way to each pulse
    const pad = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 14 }, envelope: { attack: 2, decay: 1, sustain: 0.85, release: 3 } }))
    pad.maxPolyphony = 12
    pad.volume.value = -18
    const padDuck = keep(new Tone.Gain(1))
    const padLp = keep(new Tone.Filter(800, 'lowpass'))
    pad.chain(keep(new Tone.Filter(150, 'highpass')), padLp, padDuck)
    route(padDuck, 1)
    // The pad breathes: its low-pass drifts 600-1000 Hz over about 24 s (10-4: "a little bland")
    keep(new Tone.LFO({ frequency: 1 / 24, min: 600, max: 1000 })).connect(padLp.frequency).start()

    // The pulse: a sine with a triangle an octave up, 8 ms in, 160 ms out, low-passed near 180 Hz, dry
    const pulseLp = keep(new Tone.Filter(180, 'lowpass'))
    const pulseSine = keep(new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.008, decay: 0.16, sustain: 0, release: 0.05 } }))
    const pulseTri = keep(new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.008, decay: 0.16, sustain: 0, release: 0.05 } }))
    // Measured: at the synths' default level the pulse was 81% of the mix's energy
    pulseSine.volume.value = -14
    pulseTri.volume.value = -20
    pulseSine.connect(pulseLp)
    pulseTri.connect(pulseLp)
    route(pulseLp, 0)

    // Sessions: pulse waves, each voice its own width and place in the stereo field, a dry onset
    const WIDTH = { keys: 0.5, pluck: 0.3, mallet: 0.15, cello: 0.65 }
    const PAN = { keys: -0.18, pluck: 0.18, mallet: -0.08, cello: 0.08 }
    const voices = {}
    for (const t of Object.keys(WIDTH)) {
      const v = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'pulse', width: WIDTH[t] }, envelope: { attack: 0.006, decay: t === 'cello' ? 0.5 : 0.25, sustain: 0, release: 0.2 } }))
      v.maxPolyphony = 8
      v.volume.value = -17
      const pan = keep(new Tone.Panner(PAN[t]))
      v.chain(keep(new Tone.Filter(2400, 'lowpass')), pan)
      route(pan, 0.15)
      voices[t] = v
    }

    // Working: a quiet square, the add9; full: a short band-passed noise tick
    const accent = keep(new Tone.Synth({ oscillator: { type: 'pulse', width: 0.4 }, envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.3 } }))
    accent.volume.value = -22
    const accentLp = keep(new Tone.Filter(1800, 'lowpass'))
    accent.connect(accentLp)
    route(accentLp, 0.3)
    const tickBand = keep(new Tone.Filter({ frequency: 2000, type: 'bandpass', Q: 1.2 }))
    const tick = keep(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } }))
    tick.volume.value = -26
    tick.connect(tickBand)
    route(tickBand, 0.1)

    // Working: the galaxy-map arpeggio (ME1's "Uncharted Worlds" ostinato, in craft not notes): quiet saw
    // eighths on the chord's tones through a resonant low-pass that sweeps every 8 bars or so, a dotted-
    // eighth echo, mostly in the hall. Texture under the sessions, not a voice of its own.
    const arpLp = keep(new Tone.Filter({ frequency: 900, type: 'lowpass', Q: 4 }))
    keep(new Tone.LFO({ frequency: 1 / 19, min: 500, max: 1700 })).connect(arpLp.frequency).start()
    const arpEcho = keep(stereo(new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.32, wet: 0.3 })))
    const arp = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.006, decay: 0.22, sustain: 0, release: 0.2 } }))
    arp.maxPolyphony = 6
    arp.volume.value = -27
    arp.chain(arpLp, arpEcho)
    route(arpEcho, 0.45)
    // Full: CS-80 brass, a slow detuned-saw swell whose filter opens as it grows, on each chord change
    const brass = keep(new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 16 },
      envelope: { attack: 0.9, decay: 0.8, sustain: 0.7, release: 1.8 },
      filter: { Q: 1, type: 'lowpass', rolloff: -24 },
      filterEnvelope: { attack: 1.2, decay: 1, sustain: 0.5, release: 1.8, baseFrequency: 260, octaves: 2.2 },
    }))
    brass.maxPolyphony = 6
    brass.volume.value = -24
    route(brass, 0.6)

    // Asks and commits: short sine blips, an octave above the pad
    const blip = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.004, decay: 0.5, sustain: 0, release: 0.4 } }))
    blip.maxPolyphony = 8
    blip.volume.value = -12
    route(blip, 0.2)

    return {
      pad(notes, time, dur, vel) { pad.triggerAttackRelease(notes.map(hz), dur, time, vel) },
      voice(timbre, m, time, dur, vel) { (voices[timbre] || voices.keys).triggerAttackRelease(hz(m), Math.min(dur, 0.6), time, vel) },
      bell(m, time, dur, vel) { blip.triggerAttackRelease(hz(m), Math.min(dur, 1), time, vel) },
      layer(name, notes, time, dur, vel) {
        if (name === 'pulse') {
          pulseSine.triggerAttackRelease(hz(notes[0]), dur, time, vel)
          pulseTri.triggerAttackRelease(hz(notes[0] + 12), dur, time, vel)
          padDuck.gain.setTargetAtTime(0.79, time, 0.005) // about 2 dB
          padDuck.gain.setTargetAtTime(1, time + 0.05, 0.08)
          return true
        }
        if (name === 'accent') { accent.triggerAttackRelease(hz(notes[0]), dur, time, vel); return true }
        if (name === 'tick') { tick.triggerAttackRelease(dur, time, vel); return true }
        if (name === 'arp') { arp.triggerAttackRelease(hz(notes[0]), dur, time, vel); return true }
        if (name === 'brass') { brass.triggerAttackRelease(notes.map(hz), dur, time, vel); return true }
        return false
      },
      tier(t) { hallIn.gain.rampTo([0.3, 0.18, 0.12][t] ?? 0.3, 2) },
      tempo: retime(arpEcho),
      dispose() { for (const n of nodes) { try { n.dispose() } catch {} } },
    }
  }

  // Deep field (after Stellaris; docs/space-styles.md): strings, an organ that only rises on a commit,
  // a sine-and-saw ostinato over a pedal, all in one big hall. Everything is synthesized and ready at
  // once; given smplr (the Sampled engine), a real harp, celesta and cello take over the sessions' voices
  // as each one loads (2-4 MB apiece, only when this style first plays). The strings and organ stay
  // synthesized: smplr's sustained string samples clicked on audio-block boundaries (6 a minute,
  // 0 with them muted, 0 with these), and Stellaris's own palette is mostly synths anyway.
  async function makeDeepField(io, sm = null) {
    const { Tone, out, ctx } = io
    const nodes = []
    const keep = (n) => (nodes.push(n), n)
    const hall = keep(new Tone.Reverb({ decay: 6.5, preDelay: 0.05, wet: 1 }))
    await hall.generate()
    const level = keep(stereo(new Tone.Gain(1))) // measured: at 1.4 it ran 3 dB over the other styles
    level.connect(out)
    const hallIn = keep(stereo(new Tone.Gain(0.35)))
    hallIn.chain(hall, keep(new Tone.Filter(5000, 'lowpass')), level)
    const dry = keep(stereo(new Tone.Gain(1)))
    dry.connect(level)
    const route = (node, send) => {
      node.connect(dry)
      if (send) { const g = keep(new Tone.Gain(send)); node.connect(g); g.connect(hallIn) }
    }
    const poly = (voice, opts, volume, send, ...filters) => {
      const v = keep(new Tone.PolySynth(voice, opts))
      v.maxPolyphony = 12
      v.volume.value = volume
      const chain = filters.map((f) => keep(f))
      if (chain.length) { v.chain(...chain); route(chain[chain.length - 1], send) } else route(v, send)
      return v
    }

    const strings = poly(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 24 }, envelope: { attack: 1.2, decay: 1, sustain: 0.8, release: 2.5 } }, -17, 0.8,
      new Tone.Filter(120, 'highpass'), new Tone.Filter(2000, 'lowpass'))
    const organ = poly(Tone.Synth, { oscillator: { type: 'custom', partials: [1, 0.5, 0.3, 0.2, 0.1] }, envelope: { attack: 0.25, decay: 0.5, sustain: 0.8, release: 1.5 } }, -22, 0.6,
      new Tone.Filter(3000, 'lowpass'))
    // "Some sine and sawtooth waveforms": the ostinato is a sine with a quiet saw under it, kept dark
    const ostLp = keep(new Tone.Filter(1200, 'lowpass'))
    route(ostLp, 0.35)
    const ost = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.4 } }))
    const ostSaw = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.05, release: 0.3 } }))
    ost.volume.value = -18
    ostSaw.volume.value = -30
    ost.connect(ostLp)
    ostSaw.connect(ostLp)
    const pedalLp = keep(new Tone.Filter(300, 'lowpass'))
    route(pedalLp, 0.2)
    const pedal = keep(new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 1.5 } }))
    pedal.volume.value = -16
    pedal.connect(pedalLp)
    const boom = keep(new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 2, envelope: { attack: 0.004, decay: 1.6, sustain: 0, release: 0.4 } }))
    boom.volume.value = -16
    route(boom, 0.5)
    // The drive (after "Synthetic God"): a kick on the beat, a tight sub on the eighths, a square
    // sequencer on the ostinato's notes in sixteenths, an off-beat hat; for the lift before it, a soft
    // noise riser. Tight means short: nothing here rings past its step.
    const kick = keep(new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 5, envelope: { attack: 0.002, decay: 0.32, sustain: 0, release: 0.1 } }))
    kick.volume.value = -13
    route(kick, 0.04)
    const subLp = keep(new Tone.Filter(220, 'lowpass'))
    route(subLp, 0)
    const subBass = keep(new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.006, decay: 0.16, sustain: 0, release: 0.05 } }))
    subBass.volume.value = -15
    subBass.connect(subLp)
    const seq = poly(Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.004, decay: 0.1, sustain: 0, release: 0.06 } }, -27, 0.3,
      new Tone.Filter(2200, 'lowpass'))
    const hatHp = keep(new Tone.Filter(7000, 'highpass'))
    route(hatHp, 0.15)
    const hat = keep(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } }))
    hat.volume.value = -31
    hat.connect(hatHp)
    const riserBp = keep(new Tone.Filter({ frequency: 300, type: 'bandpass', Q: 2 }))
    route(riserBp, 0.6)
    const riser = keep(new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 2, decay: 0.1, sustain: 1, release: 0.25 } }))
    riser.volume.value = -30
    riser.connect(riserBp)

    // Night watch's choir (Stellaris keeps its choir sparing): a slow "ooh" of detuned saws through two
    // vowel formants with a little vibrato, mostly in the hall
    const choirMix = keep(new Tone.Gain(1))
    route(choirMix, 0.9)
    const choirVib = keep(new Tone.Vibrato({ frequency: 4.6, depth: 0.04 }))
    for (const [f, q] of [[520, 3.5], [920, 4.5]]) choirVib.connect(keep(new Tone.Filter({ frequency: f, type: 'bandpass', Q: q })).connect(choirMix))
    const choir = keep(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 2.4, decay: 1, sustain: 0.8, release: 3.5 } }))
    choir.maxPolyphony = 8
    choir.volume.value = -14
    choir.connect(choirVib)

    const voices = {
      keys: poly(Tone.FMSynth, { harmonicity: 2, modulationIndex: 1, envelope: { attack: 0.005, decay: 1.2, sustain: 0, release: 0.8 } }, -14, 0.4),
      pluck: poly(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.004, decay: 0.6, sustain: 0, release: 0.4 } }, -14, 0.4),
      mallet: poly(Tone.FMSynth, { harmonicity: 3.5, modulationIndex: 2, envelope: { attack: 0.002, decay: 1.5, sustain: 0, release: 1 } }, -16, 0.5),
      cello: poly(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 10 }, envelope: { attack: 0.15, decay: 1, sustain: 0.4, release: 0.8 } }, -18, 0.4, new Tone.Filter(1500, 'lowpass')),
    }
    const blip = poly(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.004, decay: 0.7, sustain: 0, release: 0.5 } }, -12, 0.4)

    // Real instruments, each replacing its synthesized stand-in once it's loaded
    const real = {}
    if (sm && ctx) {
      const load = (key, instrument, lvl, send) => {
        const g = keep(new Tone.Gain(lvl))
        route(g, send)
        try {
          const i = sm.Soundfont(ctx, { instrument, destination: g.input })
          i.ready.then(() => { real[key] = i }).catch(() => {})
        } catch {}
      }
      load('harp', 'orchestral_harp', 0.9, 0.4)
      load('celesta', 'celesta', 0.8, 0.5)
      load('cello', 'cello', 0.6, 0.4)
    }
    const v127 = (v) => Math.max(1, Math.min(127, Math.round(v * 127)))
    const play = (inst, notes, time, dur, vel) => { for (const m of notes) inst.start({ note: m, velocity: v127(vel), time, duration: dur }) }

    return {
      pad(notes, time, dur, vel) { strings.triggerAttackRelease(notes.map(hz), dur, time, vel) },
      voice(timbre, m, time, dur, vel) {
        const r = timbre === 'mallet' ? real.celesta : timbre === 'cello' ? real.cello : real.harp
        if (r) play(r, [m], time, timbre === 'cello' ? dur * 2 : dur * 3, vel)
        else (voices[timbre] || voices.keys).triggerAttackRelease(hz(m), dur, time, vel)
      },
      bell(m, time, dur, vel) { if (real.celesta) play(real.celesta, [m], time, dur * 2, vel); else blip.triggerAttackRelease(hz(m), Math.min(dur, 1.2), time, vel) },
      layer(name, notes, time, dur, vel) {
        if (name === 'ostinato') { ost.triggerAttackRelease(hz(notes[0]), dur, time, vel); ostSaw.triggerAttackRelease(hz(notes[0]), dur, time, vel); return true }
        if (name === 'pedal') { pedal.triggerAttackRelease(hz(notes[0]), dur, time, vel); return true }
        if (name === 'organ') { organ.triggerAttackRelease(notes.map(hz), dur, time, vel); return true }
        if (name === 'choir') { choir.triggerAttackRelease(notes.map(hz), dur, time, vel); return true }
        if (name === 'boom') { boom.triggerAttackRelease(hz(notes[0]), '2n', time, vel); return true }
        if (name === 'kick') { kick.triggerAttackRelease(hz(notes[0]), 0.2, time, vel); return true }
        if (name === 'sub') { subBass.triggerAttackRelease(hz(notes[0]), dur, time, vel); return true }
        if (name === 'seq') { seq.triggerAttackRelease(hz(notes[0]), dur, time, vel); return true }
        if (name === 'hat') { hat.triggerAttackRelease(dur, time, vel); return true }
        if (name === 'riser') {
          riser.envelope.attack = Math.max(0.2, dur - 0.25)
          riserBp.frequency.setValueAtTime(300, time)
          riserBp.frequency.exponentialRampToValueAtTime(3200, time + dur)
          riser.triggerAttackRelease(Math.max(0.2, dur - 0.25), time, vel)
          return true
        }
        return false
      },
      tier(t) { hallIn.gain.rampTo([0.35, 0.25, 0.2][t] ?? 0.35, 2) },
      dispose() {
        for (const i of Object.values(real)) { try { i.stop() } catch {} }
        for (const n of nodes) { try { n.dispose() } catch {} }
      },
    }
  }

  function makeSour(io, send, { volume = -21 } = {}) {
    const { Tone } = io
    const band = new Tone.Filter({ frequency: 1500, type: 'bandpass', Q: 1.1 })
    const trem = new Tone.Tremolo({ frequency: 5.5, depth: 0.55 }).start()
    const syn = new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 1.1, decay: 0.1, sustain: 1, release: 1.4 } })
    syn.volume.value = volume
    syn.chain(band, trem)
    send(trem, { dry: 1, rv: 0.35 })
    return {
      on: (midi, time) => syn.triggerAttack(hz(midi), time, 0.7),
      move: (midi, time) => syn.frequency.rampTo(hz(midi), 0.35, time),
      off(midi, time, to) {
        syn.frequency.rampTo(hz(to), 0.5, time)
        syn.triggerRelease(time + 0.9)
      },
      dispose: () => [band, trem, syn].forEach((n) => n.dispose()),
    }
  }

  // Load a script once (engines fetch their libraries only when picked)
  const loaded = new Map()
  function loadScript(src) {
    if (!loaded.has(src)) {
      loaded.set(src, new Promise((resolve, reject) => {
        const el = document.createElement('script')
        el.src = src
        el.onload = resolve
        el.onerror = () => reject(new Error('could not load ' + src))
        document.head.appendChild(el)
      }))
    }
    return loaded.get(src)
  }

  window.UndertoneEngines = {
    list: [], // { id, label, blurb, local, file, create }
    add(def) { this.list.push(def) },
    get(id) { return this.list.find((d) => d.id === id) },
    kit: { hz, fold, stereo, makeFx, makeTexture, makeDrone, makeSour, makeFarShore, makeDeepField, loadScript },
  }
})()
