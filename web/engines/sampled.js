// Sampled: real recorded instruments through smplr. A Wurlitzer, a vibraphone, nylon guitar,
// Mellotron strings, upright bass and a LinnDrum. Samples load from smpldsnds.github.io the
// first time you pick it, so it runs on the local page only.

window.UndertoneEngines.add({
  id: 'sampled',
  label: 'Sampled',
  blurb: 'Real instruments via smplr: Wurlitzer, vibes, nylon guitar, Mellotron strings, upright bass, LinnDrum.',
  local: true,
  create() {
    const { makeFx, makeTexture, makeDrone, makeSour } = window.UndertoneEngines.kit
    const SMPLR = 'https://cdn.jsdelivr.net/npm/smplr@1.1.0/dist/index.mjs'
    let fx, texture, drone, sour, padFilter, padGain, inst = {}, drumNames = []
    let pumpDepth = 0 // house side-chains the pad to the kick
    const nodes = []
    const keep = (...n) => (nodes.push(...n), n[0])
    const v127 = (v) => Math.max(1, Math.min(127, Math.round(v * 127)))
    const pickDrum = (...names) => names.find((n) => drumNames.includes(n)) || names[names.length - 1]

    // Each instrument writes into a Tone gain of its own, which carries the dry level and the sends
    function channel(io, level, opts) {
      const g = keep(new io.Tone.Gain(level))
      fx.send(g, opts)
      return g.input
    }

    return {
      async init(io) {
        const { Tone, ctx } = io
        io.status('Loading samples')
        const sm = await import(SMPLR)
        fx = await makeFx(io, { decay: 5.5 })
        padFilter = keep(new Tone.Filter({ frequency: 1400, type: 'lowpass', rolloff: -12 }))
        padGain = keep(new Tone.Gain(0.8))
        padFilter.connect(padGain)
        fx.send(padGain, { dry: 1, rv: 0.6 })

        inst.pad = sm.Mellotron(ctx, { instrument: 'MIXED STRGS', destination: padFilter.input })
        inst.bass = sm.Smolken(ctx, { instrument: 'Pizzicato', destination: channel(io, 0.3, { dry: 1, rv: 0.08 }) })
        inst.keys = sm.ElectricPiano(ctx, { instrument: 'WurlitzerEP200', destination: channel(io, 0.55, { dry: 1, rv: 0.3, ec: 0.1 }) })
        inst.pluck = sm.Soundfont(ctx, { instrument: 'acoustic_guitar_nylon', destination: channel(io, 1.6, { dry: 0.9, rv: 0.25, ec: 0.35 }) })
        inst.mallet = sm.Mallet(ctx, { instrument: 'Vibraphone - Soft Mallets', destination: channel(io, 0.6, { dry: 1, rv: 0.4, ec: 0.12 }) })
        inst.cello = sm.Mellotron(ctx, { instrument: '300 STRINGS CELLO', destination: channel(io, 0.8, { dry: 1, rv: 0.5 }) })
        inst.bell = sm.Soundfont(ctx, { instrument: 'celesta', destination: channel(io, 1.2, { dry: 0.9, rv: 0.6, ec: 0.25 }) })
        inst.drums = sm.DrumMachine(ctx, { instrument: 'LM-2', destination: channel(io, 1.0, { dry: 1, rv: 0.1 }) })
        await Promise.all(Object.values(inst).map((i) => i.ready))
        drumNames = inst.drums.getSampleNames ? inst.drums.getSampleNames() : []
        // Jazz comping on a Rhodes (General MIDI electric piano 1; smplr's CP80 set has missing samples).
        // Loaded on the side: until it's in (or if it never comes), the Wurlitzer comps instead, so the
        // engine never waits on it or breaks over it
        try {
          const rhodes = sm.Soundfont(ctx, { instrument: 'electric_piano_1', destination: channel(io, 0.9, { dry: 1, rv: 0.3, ec: 0.05 }) })
          rhodes.ready.then(() => { inst.comp = rhodes }).catch(() => {})
        } catch {}

        texture = makeTexture(io)
        drone = makeDrone(io, fx.send)
        sour = makeSour(io, fx.send, { volume: -15 })
        io.status('')
      },
      dispose() {
        for (const i of Object.values(inst)) { try { i.stop(); i.disconnect && i.disconnect() } catch {} }
        for (const n of nodes) { try { n.dispose() } catch {} }
        for (const x of [fx, texture, drone, sour]) if (x) x.dispose()
        inst = {}
      },
      pad(notes, time, dur, vel) {
        for (const m of notes) inst.pad.start({ note: m, velocity: v127(vel * 0.75), time, duration: dur })
      },
      bass(m, time, dur, vel) { inst.bass.start({ note: m, velocity: v127(vel), time, duration: dur }) },
      voice(timbre, m, time, dur, vel) {
        const i = inst[timbre]
        if (i) i.start({ note: m, velocity: v127(vel), time, duration: timbre === 'cello' ? dur * 2 : dur * 3 })
      },
      drum(kind, time, vel, m) {
        const name = kind === 'kick' ? pickDrum('kick')
          : kind === 'snare' ? pickDrum('snare-m', 'snare-h', 'snare')
          : kind === 'hat' ? pickDrum('hhclosed-short', 'hhclosed')
          : kind === 'ride' ? pickDrum('ride', 'crash', 'hhopen')
          : kind === 'stick' ? pickDrum('stick-m', 'stick-h', 'stick-l', 'snare-l')
          : kind === 'clap' ? pickDrum('clap', 'snare-h')
          : kind === 'openhat' ? pickDrum('hhopen', 'hhclosed')
          : kind === 'tom' ? pickDrum(m && m < 40 ? 'tom-l' : 'tom-m', 'conga-l', 'kick-alt')
          : pickDrum('snare-l', 'cabasa')
        inst.drums.start({ note: name, velocity: v127(vel * (kind === 'hat' ? 0.7 : kind === 'ride' ? 0.6 : 1)), time })
        if (kind === 'kick' && pumpDepth) {
          padGain.gain.setTargetAtTime(0.8 * (1 - pumpDepth), time, 0.006)
          padGain.gain.setTargetAtTime(0.8, time + 0.06, 0.09)
        }
      },
      bell(m, time, dur, vel) { inst.bell.start({ note: m, velocity: v127(vel), time, duration: dur * 2 }) },
      comp(notes, time, dur, vel) {
        const piano = inst.comp || inst.keys
        for (const m of notes) piano.start({ note: m, velocity: v127(vel * (inst.comp ? 1 : 0.8)), time, duration: dur })
      },
      drumKinds: ['kick', 'snare', 'hat', 'tom', 'rim', 'ride', 'stick', 'clap', 'openhat'],
      style(name) { pumpDepth = name === 'house' ? 0.5 : 0 },
      sour(state, m, time, to) { sour[state](m, time, to) },
      drone(level, tonic, time) { drone.set(level, tonic, time) },
      texture(a) { texture.set(a) },
      energy(e, time, base) { padFilter.frequency.rampTo((base || 1000) * (0.9 + e * 1.4), 2, time) },
    }
  },
})
