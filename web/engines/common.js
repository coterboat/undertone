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
//   drum(kind, time, vel, midi)            kind: kick | snare | hat | tom | rim
//   bell(midi, time, dur, vel)
//   sour(state, midi, time, to)            state: on | move | off (to = the note it resolves into)
//   drone(level, tonic, time)              level 0..1
//   texture(amount)                        tape hiss and vinyl, 0..1
//   energy(e, time)                        0..1, how busy the sessions are
//   level(amount)                          only engines that play outside the page (SuperCollider)

(() => {
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)
  const fold = (n, lo, hi) => { while (n < lo) n += 12; while (n > hi) n -= 12; return n }

  // A reverb and a dotted-eighth echo, with a helper that wires a source dry plus sends
  async function makeFx(io, { decay = 6.5 } = {}) {
    const { Tone, out } = io
    const verb = new Tone.Reverb({ decay, preDelay: 0.03, wet: 1 })
    await verb.generate()
    verb.connect(out)
    const verbIn = new Tone.Gain(1).connect(verb)
    const echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.36, wet: 1 })
    const echoTone = new Tone.Filter(2600, 'lowpass')
    echo.chain(echoTone, out)
    echoTone.connect(new Tone.Gain(0.4).connect(verbIn))
    const echoIn = new Tone.Gain(1).connect(echo)
    const nodes = [verb, verbIn, echo, echoTone, echoIn]
    const send = (node, { dry = 1, rv = 0, ec = 0, to = out } = {}) => {
      const parts = [new Tone.Gain(dry)]
      node.connect(parts[0]); parts[0].connect(to)
      if (rv) { const g = new Tone.Gain(rv); node.connect(g); g.connect(verbIn); parts.push(g) }
      if (ec) { const g = new Tone.Gain(ec); node.connect(g); g.connect(echoIn); parts.push(g) }
      nodes.push(...parts)
      return node
    }
    return { verbIn, echoIn, send, dispose: () => nodes.forEach((n) => n.dispose()) }
  }

  // Tape hiss and vinyl crackle: a generated six-second loop, no samples. Soft by design:
  // the crackle is sparse and its loudest clicks are capped.
  function makeTexture(io) {
    const { Tone, ctx, out } = io
    const sr = ctx.sampleRate
    const len = Math.floor(sr * 6)
    const buf = new Float32Array(len)
    for (let i = 0; i < len; i++) buf[i] = (Math.random() * 2 - 1) * 0.005
    for (let i = Math.floor(sr * 0.05); i < len; i += Math.floor(sr * (0.04 + Math.random() * 0.4))) {
      const amp = Math.pow(Math.random(), 4) * 0.22 + 0.015
      const n = Math.floor(sr * 0.0012)
      for (let k = 0; k < n && i + k < len; k++) buf[i + k] += amp * (Math.random() * 2 - 1) * Math.exp(-k / (n * 0.3))
    }
    const player = new Tone.Player(Tone.ToneAudioBuffer.fromArray(buf))
    player.loop = true
    const hp = new Tone.Filter(900, 'highpass')
    const lp = new Tone.Filter(7000, 'lowpass')
    const gain = new Tone.Gain(0)
    player.chain(hp, lp, gain, out)
    player.start()
    return {
      // 0 is silent; 1 is about -24 dB under the music
      set: (a) => gain.gain.rampTo(a <= 0.001 ? 0 : 0.012 + a * 0.05, 0.4),
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
    kit: { hz, fold, makeFx, makeTexture, makeDrone, makeSour, loadScript },
  }
})()
