// All sound is synthesised with the Web Audio API: wind that follows the
// speed, a slow drone under it, and plucked notes for the things you touch.
let ctx = null
let master = null
let wind = null
let drone = null

function audio() {
    if (typeof window === "undefined") return null
    if (!ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) return null
        ctx = new Ctx()
        master = ctx.createGain()
        master.gain.value = 0.6
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = -12
        limiter.ratio.value = 6
        master.connect(limiter).connect(ctx.destination)
    }
    if (ctx.state === "suspended") ctx.resume()
    return ctx
}

function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
        // Slightly brown noise: softer than white.
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04
        data[i] = last * 6
    }
    return buffer
}

// D minor pentatonic: every note agrees with every other.
const SCALE = [0, 3, 5, 7, 10]
const note = (step) => 146.83 * 2 ** ((SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12)

function pluck(freq, at = 0, gain = 0.2, decay = 1.4) {
    const t = ctx.currentTime + at
    const osc = ctx.createOscillator()
    const over = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = "triangle"
    over.type = "sine"
    osc.frequency.value = freq
    over.frequency.value = freq * 3.01
    const overGain = ctx.createGain()
    overGain.gain.value = 0.18
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006)
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(env)
    over.connect(overGain).connect(env)
    env.connect(master)
    osc.start(t)
    over.start(t)
    osc.stop(t + decay + 0.05)
    over.stop(t + decay + 0.05)
}

// Start the bed of wind and drone. Safe to call again.
export function startAmbience() {
    if (!audio() || wind) return
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(3)
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.Q.value = 0.6
    filter.frequency.value = 400
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter).connect(gain).connect(master)
    src.start()
    wind = { filter, gain }

    const out = ctx.createGain()
    out.gain.value = 0
    const tone = ctx.createBiquadFilter()
    tone.type = "lowpass"
    tone.frequency.value = 900
    ;[note(-5), note(-5) * 1.004, note(-2), note(0) * 0.998].forEach((f, i) => {
        const o = ctx.createOscillator()
        o.type = i < 2 ? "sawtooth" : "triangle"
        o.frequency.value = f
        const g = ctx.createGain()
        g.gain.value = i < 2 ? 0.05 : 0.07
        o.connect(g).connect(tone)
        o.start()
    })
    tone.connect(out).connect(master)
    out.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4)
    drone = { out, tone }
}

// Called every frame-ish with the flight's speed and height above ground.
export function setFlightSound(speed, low, on) {
    if (!ctx || !wind) return
    const t = ctx.currentTime
    const s = Math.min(Math.max((speed - 20) / 80, 0), 1)
    wind.gain.gain.setTargetAtTime(on ? 0.05 + s * 0.5 + low * 0.2 : 0, t, 0.25)
    wind.filter.frequency.setTargetAtTime(300 + s * 1500 + low * 500, t, 0.25)
    drone.out.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.6)
    drone.tone.frequency.setTargetAtTime(600 + s * 1400, t, 0.5)
}

export function mute() {
    if (!ctx || !wind) return
    setFlightSound(0, 0, false)
}

const SOUNDS = {
    // Each lantern in a string plays the next note up.
    lantern({ combo = 1 } = {}) {
        const step = 5 + Math.min(combo - 1, 9)
        pluck(note(step), 0, 0.22, 1.6)
        pluck(note(step + 2), 0.07, 0.1, 1.2)
    },
    thermal() {
        [5, 7, 9, 12].forEach((s, i) => pluck(note(s), i * 0.11, 0.09, 1.8))
    },
    // A gate: a low bell with a bright answer.
    gate() {
        pluck(note(0), 0, 0.26, 2.6)
        pluck(note(5), 0.05, 0.16, 2.2)
        pluck(note(9), 0.16, 0.1, 1.8)
    },
    stamp() {
        pluck(note(7), 0, 0.12, 0.9)
        pluck(note(10), 0.12, 0.12, 1.4)
    },
    skim() {
        pluck(note(10), 0, 0.07, 0.5)
    },
    begin() {
        [0, 2, 5].forEach((s, i) => pluck(note(s), i * 0.14, 0.16, 2.2))
    },
    crash() {
        const t = ctx.currentTime
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = "sine"
        o.frequency.setValueAtTime(120, t)
        o.frequency.exponentialRampToValueAtTime(38, t + 0.5)
        g.gain.setValueAtTime(0.5, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
        o.connect(g).connect(master)
        o.start(t)
        o.stop(t + 0.8)
        ;[4, 2, 0].forEach((s, i) => pluck(note(s), 0.5 + i * 0.3, 0.14, 2.4))
    },
    tick() {
        pluck(note(12), 0, 0.06, 0.25)
    },
}

export function play(name, options) {
    try {
        if (!audio()) return
        SOUNDS[name]?.(options)
    } catch {
        // Audio is a nice-to-have; never let it break the flight.
    }
}
