// undertone's ears: turns a WAV clip into numbers and a picture Claude can read.
//
// analyzeClip(mono, sampleRate) -> { stats, png, legend }
//   stats   loudness, peaks, clipping, clicks, band balance, brightness, loudness over time
//   png     a log-frequency spectrogram (30 Hz at the bottom, top at 16 kHz or Nyquist), with a
//           loudness strip underneath; faint lines mark 100 Hz, 1 kHz, 10 kHz and every 5 seconds,
//           and red ticks in the strip mark detected clicks
// No dependencies: its own FFT, WAV reader/writer and PNG encoder.

import zlib from 'node:zlib'

// ---------------------------------------------------------------- WAV

export function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let off = 12
  let fmt = null
  let data = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(body)
      if (format === 0xfffe) format = buf.readUInt16LE(body + 24) // WAVE_FORMAT_EXTENSIBLE: the subformat
      fmt = { format, channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      data = { start: body, size: Math.min(size, buf.length - body) }
    }
    off = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV has no fmt or data chunk')
  const { format, channels, sampleRate, bits } = fmt
  const bytes = bits / 8
  const frames = Math.floor(data.size / (bytes * channels))
  const mono = new Float32Array(frames)
  const read = format === 3 && bits === 32 ? (o) => buf.readFloatLE(o)
    : bits === 16 ? (o) => buf.readInt16LE(o) / 32768
    : bits === 24 ? (o) => buf.readIntLE(o, 3) / 8388608
    : bits === 32 ? (o) => buf.readInt32LE(o) / 2147483648
    : null
  if (!read) throw new Error('unsupported WAV: format ' + format + ', ' + bits + ' bits')
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += read(data.start + (i * channels + c) * bytes)
    mono[i] = sum / channels
  }
  return { sampleRate, channels, mono }
}

export function writeWav(mono, sampleRate) {
  const out = Buffer.alloc(44 + mono.length * 2)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + mono.length * 2, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(mono.length * 2, 40)
  for (let i = 0; i < mono.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))), 44 + i * 2)
  return out
}

// ---------------------------------------------------------------- FFT

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (-2 * Math.PI) / len
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(ang * k)
      const wi = Math.sin(ang * k)
      for (let i = k; i < n; i += len) {
        const j = i + half
        const br = re[j] * wr - im[j] * wi
        const bi = re[j] * wi + im[j] * wr
        re[j] = re[i] - br; im[j] = im[i] - bi
        re[i] += br; im[i] += bi
      }
    }
  }
}

// ---------------------------------------------------------------- PNG

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(tb) >>> 0)
    return Buffer.concat([len, tb, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Dark purple through orange to pale yellow, so quiet reads dark and loud reads bright
const STOPS = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]]
function color(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f))
}

// ---------------------------------------------------------------- analysis

const BANDS = [['sub', 20, 60], ['bass', 60, 250], ['lowMid', 250, 800], ['mid', 800, 2500], ['presence', 2500, 6000], ['air', 6000, 24000]]
const db = (a) => (a > 0 ? Math.round(20 * Math.log10(a) * 10) / 10 : -120)

// True when the step at i comes back, same direction and at least half its size, three times in a row
// a period apart (before it, after it or both: a note's first cycle has none before, and a second note
// can cut the run short) for some period between 1.5 and 25 ms (40-660 Hz): the edge of a pulse or saw wave
// playing a note. A click caused by a glitch doesn't repeat at a pitch. A click on top of a buzzy tone
// still counts when it's more than twice the tone's own edges.
export function pitchEdge(mono, i, sampleRate) {
  const s = mono[i] - mono[i - 1]
  const need = Math.abs(s) * 0.5
  const stepAt = (j) => {
    let best = -Infinity
    for (let k = j - 1; k <= j + 1; k++) if (k >= 1 && k < mono.length) best = Math.max(best, (mono[k] - mono[k - 1]) * Math.sign(s))
    return best
  }
  const lo = Math.round(sampleRate * 0.0015), hi = Math.round(sampleRate * 0.025)
  for (let p = lo; p <= hi; p++) {
    // A step that repeats every audio block (128 samples) or a multiple is a buffer glitch, not a pitch
    // (Codex RV-002 F4). A note whose period lands there is counted as clicks: the safe side to err on.
    if (p % 128 <= 1 || p % 128 >= 127) continue
    let run = 0
    for (let k = 1; k <= 3 && stepAt(i + k * p) >= need; k++) run++
    for (let k = 1; k <= 3 && stepAt(i - k * p) >= need; k++) run++
    if (run >= 3) return true
  }
  return false
}

export function analyzeClip(mono, sampleRate) {
  const n = mono.length
  const N = 4096
  const fmin = 30
  const fmax = Math.min(16000, sampleRate / 2)

  // Level, clipping and loudness over time (100 ms windows)
  let peak = 0, sumSq = 0, clipped = 0
  const win = Math.floor(sampleRate / 10)
  const loudness = []
  for (let w = 0; w + win <= n; w += win) {
    let s = 0
    for (let i = w; i < w + win; i++) s += mono[i] * mono[i]
    loudness.push(db(Math.sqrt(s / win)))
  }
  for (let i = 0; i < n; i++) {
    const a = Math.abs(mono[i])
    if (a > peak) peak = a
    if (a >= 0.999) clipped++
    sumSq += mono[i] * mono[i]
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n))

  // Clicks: a jump between neighbouring samples far bigger than the jumps around it.
  // Drum hits change smoothly or noisily; a click is one sharp step on its own. A pulse or saw wave
  // has a sharp step every cycle: that's a tone, not a click (pitchEdge below)
  const clicks = []
  const ctx = Math.round(sampleRate * 0.001)
  for (let i = ctx + 2; i < n - ctx - 2; i++) {
    const d = Math.abs(mono[i] - mono[i - 1])
    if (d < 0.03) continue
    let around = 0
    for (let k = 2; k <= ctx; k++) around += Math.abs(mono[i - k] - mono[i - k - 1]) + Math.abs(mono[i + k] - mono[i + k - 1])
    around /= 2 * (ctx - 1)
    if (d > 10 * around + 0.005 && !pitchEdge(mono, i, sampleRate)) {
      if (!clicks.length || i - clicks[clicks.length - 1] > sampleRate * 0.005) clicks.push(i)
    }
  }

  // Spectrogram frames: at most ~1200 across
  const hop = Math.max(512, Math.ceil(Math.max(0, n - N) / 1200))
  const frames = Math.max(1, Math.floor(Math.max(0, n - N) / hop) + 1)
  const hann = new Float64Array(N)
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const bins = N / 2
  const binHz = sampleRate / N
  const H = 480
  const rowBins = []
  for (let y = 0; y < H; y++) {
    const fTop = fmin * Math.pow(fmax / fmin, 1 - y / H)
    const fBot = fmin * Math.pow(fmax / fmin, 1 - (y + 1) / H)
    const b0 = Math.max(1, Math.floor(fBot / binHz))
    const b1 = Math.max(b0, Math.min(bins - 1, Math.ceil(fTop / binHz)))
    rowBins.push([b0, b1])
  }
  const W = frames
  const STRIP = 60
  const img = Buffer.alloc(W * (H + STRIP) * 3)
  const total = new Float64Array(bins)
  const re = new Float64Array(N), im = new Float64Array(N)
  const norm = N / 4 // a full-scale sine reads about 0 dB through a Hann window
  const frameRms = []
  for (let f = 0; f < frames; f++) {
    const start = f * hop
    let fr = 0
    for (let i = 0; i < N; i++) {
      const v = start + i < n ? mono[start + i] : 0
      re[i] = v * hann[i]; im[i] = 0
      fr += v * v
    }
    frameRms.push(Math.sqrt(fr / N))
    fft(re, im)
    const mag = new Float64Array(bins)
    for (let b = 0; b < bins; b++) {
      const p = re[b] * re[b] + im[b] * im[b]
      total[b] += p
      mag[b] = Math.sqrt(p) / norm
    }
    for (let y = 0; y < H; y++) {
      const [b0, b1] = rowBins[y]
      let m = 0
      for (let b = b0; b <= b1; b++) if (mag[b] > m) m = mag[b]
      const t = (db(m) + 100) / 90 // -100 dB .. -10 dB
      const [r, g, bl] = color(t)
      const o = (y * W + f) * 3
      img[o] = r; img[o + 1] = g; img[o + 2] = bl
    }
  }

  // Faint guides: 100 Hz, 1 kHz, 10 kHz across; every 5 seconds down
  const yOf = (hz) => Math.round(H * (1 - Math.log(hz / fmin) / Math.log(fmax / fmin)))
  for (const hz of [100, 1000, 10000]) {
    const y = yOf(hz)
    if (y <= 0 || y >= H) continue
    for (let x = 0; x < W; x += 2) { const o = (y * W + x) * 3; img[o] = img[o + 1] = img[o + 2] = 150 }
  }
  for (let s = 5; s * sampleRate < n; s += 5) {
    const x = Math.round((s * sampleRate) / hop)
    if (x >= W) break
    for (let y = 0; y < H; y += 2) { const o = (y * W + x) * 3; img[o] = img[o + 1] = img[o + 2] = 150 }
  }
  // The loudness strip: a grey bar per frame (-60..0 dB), red ticks where clicks were found
  for (let f = 0; f < frames; f++) {
    const h = Math.max(0, Math.min(STRIP - 4, Math.round(((db(frameRms[f]) + 60) / 60) * (STRIP - 4))))
    for (let y = 0; y < STRIP; y++) {
      const o = ((H + y) * W + f) * 3
      const lit = y >= STRIP - h
      img[o] = img[o + 1] = img[o + 2] = lit ? 120 : 18
    }
  }
  for (const c of clicks) {
    const x0 = Math.min(W - 1, Math.floor(c / hop))
    for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x0 + 1); x++) {
      for (let y = 0; y < 14; y++) { const o = ((H + y) * W + x) * 3; img[o] = 255; img[o + 1] = 40; img[o + 2] = 40 }
    }
  }

  // Band balance and brightness from the whole clip's spectrum
  let all = 0, centroidNum = 0
  for (let b = 1; b < bins; b++) { all += total[b]; centroidNum += total[b] * b * binHz }
  const bands = {}
  for (const [name, lo, hi] of BANDS) {
    let e = 0
    for (let b = Math.max(1, Math.floor(lo / binHz)); b <= Math.min(bins - 1, Math.floor(hi / binHz)); b++) e += total[b]
    bands[name] = Math.round((e / Math.max(all, 1e-20)) * 1000) / 10
  }
  const seconds = n / sampleRate
  const quiet = loudness.filter((l) => l < -60).length

  const stats = {
    seconds: Math.round(seconds * 10) / 10,
    sampleRate,
    rmsDb: db(rms),
    peakDb: db(peak),
    crestDb: Math.round((db(peak) - db(rms)) * 10) / 10,
    clippedSamples: clipped,
    clicksPerMinute: Math.round((clicks.length / Math.max(seconds, 1)) * 60 * 10) / 10,
    bandsPercent: bands,
    centroidHz: Math.round(centroidNum / Math.max(all, 1e-20)),
    silentPercent: Math.round((quiet / Math.max(1, loudness.length)) * 100),
    loudnessDbPerSecond: loudness.filter((_, i) => i % 10 === 0),
  }
  const legend = {
    width: W, height: H + STRIP, spectrogramHeight: H, fminHz: fmin, fmaxHz: Math.round(fmax),
    secondsPerPixel: Math.round((hop / sampleRate) * 1000) / 1000, dbRange: [-100, -10],
    guides: 'faint horizontal lines at 100 Hz, 1 kHz, 10 kHz; vertical lines every 5 s; bottom strip is loudness (-60..0 dB) with red ticks at clicks',
  }
  return { stats, legend, png: png(W, H + STRIP, img) }
}
