// SuperCollider: the page still conducts, but every note goes to SuperCollider through the
// bridge (OSC to sclang), and SuperCollider plays it through your computer's audio. Its synths
// live in sc/undertone.scd. Needs SuperCollider installed.

// SuperCollider is one shared process; only the newest instance may claim it, and only the
// instance that claimed it may silence it
let scOwner = null
let scGen = 0

window.UndertoneEngines.add({
  id: 'sc',
  label: 'SuperCollider',
  blurb: 'Native synthesis in SuperCollider: Karplus-Strong plucks, modal bells, FM Rhodes, analog-style drums.',
  local: true,
  create() {
    let ctx, queue = [], timer = null
    const me = { gen: ++scGen }
    const send = (intent) => {
      queue.push(intent)
      if (!timer) timer = setTimeout(flush, 0)
    }
    function flush() {
      timer = null
      if (!queue.length) return
      const body = JSON.stringify(queue)
      queue = []
      fetch('/sc', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
    // SuperCollider schedules each note this far ahead of now
    const d = (time) => Math.max(0.02, time - ctx.currentTime)

    return {
      async init(io) {
        ctx = io.ctx
        io.status('Starting SuperCollider (the first boot takes a few seconds)')
        const r = await fetch('/sc/start', { method: 'POST' })
        const j = await r.json().catch(() => ({}))
        if (!j.ok) throw new Error(j.error || 'SuperCollider did not start')
        if (me.gen !== scGen) throw new Error('replaced by a newer start')
        scOwner = me
        io.status('')
      },
      dispose() {
        if (scOwner !== me) return
        scOwner = null
        send({ k: 'level', a: 0 })
        send({ k: 'sour', d: 0.02, s: 'off', m: 60, to: 60 })
        send({ k: 'drone', level: 0, tonic: 50 })
        flush()
      },
      pad(notes, time, dur, vel, home) { send({ k: 'pad', d: d(time), v: vel, dur, home: home ? 1 : 0, notes }) },
      bass(m, time, dur, vel) { send({ k: 'bass', d: d(time), m, dur, v: vel }) },
      voice(t, m, time, dur, vel) { send({ k: 'voice', d: d(time), t, m, dur, v: vel }) },
      drum(t, time, vel, m) { send({ k: 'drum', d: d(time), t, v: vel, m: m || 0 }) },
      bell(m, time, dur, vel) { send({ k: 'bell', d: d(time), m, dur, v: vel }) },
      sour(s, m, time, to) { send({ k: 'sour', d: d(time), s, m, to: to || m }) },
      drone(level, tonic) { send({ k: 'drone', level, tonic }) },
      texture(a) { send({ k: 'texture', a }) },
      energy(e, time, base) { send({ k: 'energy', d: d(time), e, base: base || 900 }) },
      tempo(bpm, time) { send({ k: 'tempo', d: d(time), bpm }) },
      level(a) { send({ k: 'level', a }) },
    }
  },
})
