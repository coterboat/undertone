// Synth: everything synthesized in the browser with Tone.js. No samples, nothing to fetch,
// so it's also the engine the published page runs.

window.UndertoneEngines.add({
  id: 'synth',
  label: 'Synth',
  blurb: 'Tone.js, all synthesized. Warm FM keys, saw pads, no samples.',
  local: false,
  create() {
    const { hz, makeFx, makeTexture, makeDrone, makeSour } = window.UndertoneEngines.kit
    let T, fx, pad, padFilter, padChorus, bass, bell, drumBus, kick, snare, hat, tom, texture, drone, sour
    const voices = {}
    const nodes = []
    const keep = (...n) => (nodes.push(...n), n[0])

    function makeVoice(timbre) {
      const { Tone } = T
      let v
      if (timbre === 'keys') {
        v = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3, modulationIndex: 1.5,
          oscillator: { type: 'sine' }, modulation: { type: 'sine' },
          envelope: { attack: 0.004, decay: 1.4, sustain: 0.12, release: 1.8 },
          modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.6 },
        })
        v.volume.value = -3
        const trem = keep(new Tone.Tremolo({ frequency: 4.2, depth: 0.22 }).start())
        v.connect(trem)
        fx.send(trem, { dry: 1, rv: 0.35, ec: 0.12 })
      } else if (timbre === 'pluck') {
        v = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.003, decay: 0.28, sustain: 0, release: 0.35 } })
        v.volume.value = -8
        const lp = keep(new Tone.Filter(3200, 'lowpass'))
        v.connect(lp)
        fx.send(lp, { dry: 0.9, rv: 0.25, ec: 0.4 })
      } else if (timbre === 'mallet') {
        v = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 4, modulationIndex: 2.2,
          oscillator: { type: 'sine' }, modulation: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.7 },
          modulationEnvelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 },
        })
        v.volume.value = -5
        fx.send(v, { dry: 1, rv: 0.4, ec: 0.15 })
      } else {
        v = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 12 }, envelope: { attack: 0.18, decay: 0.6, sustain: 0.55, release: 1.6 } })
        v.volume.value = -12
        const lp = keep(new Tone.Filter(1100, 'lowpass'))
        v.connect(lp)
        fx.send(lp, { dry: 1, rv: 0.5 })
      }
      v.maxPolyphony = 10
      return keep(v)
    }

    return {
      async init(io) {
        T = io
        const { Tone } = io
        fx = await makeFx(io)
        // A slow tape wobble on the tonal parts
        const wobble = keep(new Tone.Vibrato({ frequency: 0.32, depth: 0.03 }))
        const music = keep(new Tone.Gain(1))
        music.chain(wobble, io.out)
        const send = (node, opts) => fx.send(node, { to: music, ...opts })

        padFilter = keep(new Tone.Filter({ frequency: 900, type: 'lowpass', rolloff: -24, Q: 0.4 }))
        padChorus = keep(new Tone.Chorus({ frequency: 0.5, delayTime: 4, depth: 0.55, wet: 0.5 }).start())
        pad = keep(new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 2, spread: 22 },
          envelope: { attack: 2.2, decay: 1.5, sustain: 0.75, release: 4.5 },
        }))
        pad.maxPolyphony = 14
        pad.volume.value = -20
        pad.chain(padFilter, padChorus)
        send(padChorus, { dry: 1, rv: 0.55 })

        bass = keep(new Tone.MonoSynth({
          oscillator: { type: 'triangle' },
          filter: { Q: 1, type: 'lowpass', rolloff: -24 },
          envelope: { attack: 0.01, decay: 0.5, sustain: 0.6, release: 0.8 },
          filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.8, baseFrequency: 110, octaves: 2.2 },
        }))
        bass.volume.value = -20
        send(bass, { dry: 1, rv: 0.04 })

        bell = keep(new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 5.07, modulationIndex: 8,
          oscillator: { type: 'sine' }, modulation: { type: 'sine' },
          envelope: { attack: 0.001, decay: 2.2, sustain: 0, release: 2.2 },
          modulationEnvelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.4 },
        }))
        bell.volume.value = -8
        send(bell, { dry: 0.9, rv: 0.6, ec: 0.25 })

        drumBus = keep(new Tone.Gain(1))
        const drumTone = keep(new Tone.Filter(7000, 'lowpass'))
        drumBus.chain(drumTone, io.out)
        drumBus.connect(keep(new Tone.Gain(0.12)).connect(fx.verbIn))
        kick = keep(new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 5, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 } }))
        kick.volume.value = -9
        kick.connect(drumBus)
        const snareBand = keep(new Tone.Filter({ frequency: 1700, type: 'bandpass', Q: 0.8 }))
        snare = keep(new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.17, sustain: 0 } }))
        // Measured 30 dB under the kick on its own; both Gemini reads called the drums buried
        snare.volume.value = -3
        snare.chain(snareBand, drumBus)
        const hatHp = keep(new Tone.Filter(7500, 'highpass'))
        hat = keep(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } }))
        hat.volume.value = -18
        hat.chain(hatHp, drumBus)
        tom = keep(new Tone.MembraneSynth({ pitchDecay: 0.09, octaves: 2.5, envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.3 } }))
        tom.volume.value = -8
        tom.connect(drumBus)
        tom.connect(keep(new Tone.Gain(0.35)).connect(fx.verbIn))

        for (const t of ['keys', 'pluck', 'mallet', 'cello']) voices[t] = makeVoice(t)
        texture = makeTexture(io)
        drone = makeDrone(io, send)
        sour = makeSour(io, send, { volume: -15 })
      },
      dispose() {
        for (const n of nodes) { try { n.dispose() } catch {} }
        for (const x of [fx, texture, drone, sour]) if (x) x.dispose()
      },
      pad(notes, time, dur, vel) { pad.triggerAttackRelease(notes.map(hz), dur, time, vel) },
      bass(m, time, dur, vel) { bass.triggerAttackRelease(hz(m), dur, time, vel) },
      voice(timbre, m, time, dur, vel) { voices[timbre].triggerAttackRelease(hz(m), dur, time, vel) },
      drum(kind, time, vel, m) {
        if (kind === 'kick') kick.triggerAttackRelease('C1', '8n', time, vel)
        else if (kind === 'tom') tom.triggerAttackRelease(hz(m || 38), '4n', time, vel)
        else if (kind === 'hat') hat.triggerAttackRelease('32n', time, vel)
        else snare.triggerAttackRelease('32n', time, kind === 'rim' ? vel * 0.5 : vel)
      },
      bell(m, time, dur, vel) { bell.triggerAttackRelease(hz(m), dur, time, vel) },
      sour(state, m, time, to) { sour[state](m, time, to) },
      drone(level, tonic, time) { drone.set(level, tonic, time) },
      texture(a) { texture.set(a) },
      energy(e, time, base) { padFilter.frequency.rampTo((base || 900) * (0.75 + e * 1.6), 2, time) },
    }
  },
})
