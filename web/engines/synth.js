// Synth: everything synthesized in the browser with Tone.js. No samples, nothing to fetch,
// so it's also the engine the published page runs.

window.UndertoneEngines.add({
  id: 'synth',
  label: 'Synth',
  blurb: 'Tone.js, all synthesized. Warm FM keys, saw pads, no samples.',
  local: false,
  create() {
    const { hz, stereo, makeFx, makeTexture, makeDrone, makeSour, makeFarShore, makeDeepField } = window.UndertoneEngines.kit
    let T, fx, pad, padFilter, padChorus, padDuck, bass, bassDuck, bell, drumBus, kick, snare, hat, openhat, tom, ride, comp, texture, drone, sour
    let pumpDepth = 0
    // The space styles bring their own sounds (common.js), loaded the first time they play
    let current = 'lofi'
    const kits = {}, loading = {}
    const KITS = { farshore: () => makeFarShore(T), deepfield: () => makeDeepField(T) }
    const space = () => kits[current] || null
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
        // A rounder onset than a 1 ms strike: every read and grep plays one, and with a few busy
        // sessions they were the ticks between the drums
        v = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 4, modulationIndex: 1.8,
          oscillator: { type: 'sine' }, modulation: { type: 'sine' },
          envelope: { attack: 0.004, decay: 0.7, sustain: 0, release: 0.7 },
          modulationEnvelope: { attack: 0.003, decay: 0.15, sustain: 0, release: 0.2 },
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
        const music = keep(stereo(new Tone.Gain(1)))
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
        // House side-chains the pad to the kick (style below sets how deep)
        padDuck = keep(new Tone.Gain(1))
        pad.chain(padFilter, padChorus, padDuck)
        send(padDuck, { dry: 1, rv: 0.55 })

        bass = keep(new Tone.MonoSynth({
          oscillator: { type: 'triangle' },
          filter: { Q: 1, type: 'lowpass', rolloff: -24 },
          envelope: { attack: 0.01, decay: 0.5, sustain: 0.6, release: 0.8 },
          filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.8, baseFrequency: 110, octaves: 2.2 },
        }))
        bass.volume.value = -20
        // The kick ducks the bass for a moment, so its attack doesn't bloom into the kick's tail
        bassDuck = keep(new Tone.Gain(1))
        bass.connect(bassDuck)
        send(bassDuck, { dry: 1, rv: 0.04 })

        bell = keep(new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 5.07, modulationIndex: 8,
          oscillator: { type: 'sine' }, modulation: { type: 'sine' },
          envelope: { attack: 0.001, decay: 2.2, sustain: 0, release: 2.2 },
          modulationEnvelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.4 },
        }))
        bell.volume.value = -8
        send(bell, { dry: 0.9, rv: 0.6, ec: 0.25 })

        // Pinned to stereo: the mono kick plus stereo hat and snare noise flipped it 1-2-1 on every hit,
        // and each flip popped through the filter after it (16-24 clicks a minute, 0 pinned)
        drumBus = keep(stereo(new Tone.Gain(1)))
        const drumTone = keep(new Tone.Filter(7000, 'lowpass'))
        drumBus.chain(drumTone, io.out)
        drumBus.connect(keep(new Tone.Gain(0.12)).connect(fx.verbIn))
        // Four octaves of sweep and a 3 ms attack: a thump, not a click
        kick = keep(new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.003, decay: 0.42, sustain: 0, release: 0.1 } }))
        kick.volume.value = -9
        kick.connect(drumBus)
        // Measured 30 dB under the kick on its own; both Gemini reads called the drums buried, so it
        // went up. Then it snapped: centred lower, the 2-3 kHz poke shaved, a softer attack, 1.5 dB down
        const snareBand = keep(new Tone.Filter({ frequency: 1300, type: 'bandpass', Q: 0.7 }))
        const snareSoft = keep(new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -12 }))
        snare = keep(new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.006, decay: 0.17, sustain: 0 } }))
        snare.volume.value = -4.5
        snare.chain(snareBand, snareSoft, drumBus)
        const hatHp = keep(new Tone.Filter(7500, 'highpass'))
        hat = keep(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } }))
        hat.volume.value = -18
        hat.chain(hatHp, drumBus)
        // House: an open hat on the off-beats
        openhat = keep(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 0.22, sustain: 0 } }))
        openhat.volume.value = -22
        openhat.connect(hatHp)
        tom = keep(new Tone.MembraneSynth({ pitchDecay: 0.09, octaves: 2.5, envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.3 } }))
        tom.volume.value = -8
        tom.connect(drumBus)
        tom.connect(keep(new Tone.Gain(0.35)).connect(fx.verbIn))
        // Jazz: a ride, kept airy above 3.5 kHz
        const rideHp = keep(new Tone.Filter(3500, 'highpass'))
        ride = keep(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.1, release: 0.4 }, harmonicity: 5.1, modulationIndex: 24, resonance: 5200, octaves: 1.2 }))
        ride.volume.value = -31
        ride.chain(rideHp, drumBus)

        // Jazz comping: a warm FM electric piano, apart from the lanes' keys
        comp = keep(new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 1, modulationIndex: 3,
          oscillator: { type: 'sine' }, modulation: { type: 'sine' },
          envelope: { attack: 0.004, decay: 1.6, sustain: 0.2, release: 0.6 },
          modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.4 },
        }))
        comp.maxPolyphony = 16
        comp.volume.value = -14
        const compTrem = keep(new Tone.Tremolo({ frequency: 3.2, depth: 0.18 }).start())
        comp.connect(compTrem)
        send(compTrem, { dry: 1, rv: 0.3, ec: 0.06 })

        for (const t of ['keys', 'pluck', 'mallet', 'cello']) voices[t] = makeVoice(t)
        texture = makeTexture(io)
        drone = makeDrone(io, send)
        sour = makeSour(io, send, { volume: -15 })
      },
      dispose() {
        for (const k of Object.values(kits)) k.dispose()
        for (const n of nodes) { try { n.dispose() } catch {} }
        for (const x of [fx, texture, drone, sour]) if (x) x.dispose()
      },
      pad(notes, time, dur, vel) { if (space()) return space().pad(notes, time, dur, vel); pad.triggerAttackRelease(notes.map(hz), dur, time, vel) },
      bass(m, time, dur, vel) { bass.triggerAttackRelease(hz(m), dur, time, vel) },
      voice(timbre, m, time, dur, vel) { if (space()) return space().voice(timbre, m, time, dur, vel); voices[timbre].triggerAttackRelease(hz(m), dur, time, vel) },
      layer(name, notes, time, dur, vel) { return space() ? space().layer(name, notes, time, dur, vel) : false },
      tier(t) { for (const k of Object.values(kits)) k.tier(t) },
      comp(notes, time, dur, vel) { comp.triggerAttackRelease(notes.map(hz), dur, time, vel) },
      drumKinds: ['kick', 'snare', 'hat', 'tom', 'rim', 'ride', 'openhat'],
      // What the conductor's style needs from the sound: a walking bass that speaks its notes (a
      // brighter filter), house's pump
      style(name) {
        current = name
        if (KITS[name] && !kits[name] && !loading[name]) loading[name] = KITS[name]().then((k) => { kits[name] = k }).catch(() => { loading[name] = null })
        bass.filterEnvelope.baseFrequency = name === 'jazz' ? 210 : name === 'house' ? 140 : 110
        bass.filterEnvelope.octaves = name === 'jazz' ? 2.7 : 2.2
        pumpDepth = name === 'house' ? 0.55 : 0
      },
      drum(kind, time, vel, m) {
        // The kick holds the grid; hats and snare sit a few ms behind it and never hit the same
        // twice, so the groove breathes instead of ticking
        const late = (lo, hi) => time + (lo + Math.random() * (hi - lo)) / 1000
        const drift = (v, d) => v * (1 - Math.random() * d)
        if (kind === 'kick') {
          kick.triggerAttackRelease('C1', '8n', time, vel)
          // Glides from wherever the gain is (a hold-and-ramp jumped and clicked): down in ~10 ms,
          // back over ~200 ms
          const g = bassDuck.gain
          g.setTargetAtTime(0.45, time, 0.004)
          g.setTargetAtTime(1, time + 0.03, 0.06)
          if (pumpDepth) {
            padDuck.gain.setTargetAtTime(1 - pumpDepth, time, 0.006)
            padDuck.gain.setTargetAtTime(1, time + 0.06, 0.09)
          }
        } else if (kind === 'tom') tom.triggerAttackRelease(hz(m || 38), '4n', time, vel)
        else if (kind === 'ride') ride.triggerAttackRelease(320, '8n', late(0, 4), drift(vel, 0.15))
        else if (kind === 'openhat') openhat.triggerAttackRelease('8n', late(0, 5), drift(vel, 0.2))
        else if (kind === 'hat') hat.triggerAttackRelease('32n', late(0, 7), drift(vel, 0.25))
        else snare.triggerAttackRelease('32n', late(3, 10), drift(kind === 'rim' ? vel * 0.5 : vel, 0.12))
      },
      bell(m, time, dur, vel) { if (space()) return space().bell(m, time, dur, vel); bell.triggerAttackRelease(hz(m), dur, time, vel) },
      sour(state, m, time, to) { sour[state](m, time, to) },
      drone(level, tonic, time) { drone.set(level, tonic, time) },
      texture(a) { texture.set(a) },
      energy(e, time, base) { padFilter.frequency.rampTo((base || 900) * (0.75 + e * 1.6), 2, time) },
    }
  },
})
