// The world as pure functions of a seed: terrain height, the valley the
// glider follows, biomes, where lanterns and thermals sit, and the colours
// of the sky through a day. No three.js here, so the same code runs in
// tests and on the server.

export const WATER = 0
export const BIOMES = ["karst", "dunes", "snow"]
const SEGMENT = 2600 // metres of each biome
const BLEND = 700

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t

function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function makeWorld(seed) {
    const rng = mulberry32(seed)
    const perm = new Uint8Array(512)
    const base = Array.from({ length: 256 }, (_, i) => i)
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[base[i], base[j]] = [base[j], base[i]]
    }
    for (let i = 0; i < 512; i++) perm[i] = base[i & 255]
    const phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28]

    const lattice = (ix, iz) => perm[perm[ix & 255] + (iz & 255)] / 255
    // Smooth value noise in 0..1.
    const noise = (x, z) => {
        const ix = Math.floor(x)
        const iz = Math.floor(z)
        const fx = x - ix
        const fz = z - iz
        const u = fx * fx * (3 - 2 * fx)
        const v = fz * fz * (3 - 2 * fz)
        const a = lattice(ix, iz)
        const b = lattice(ix + 1, iz)
        const c = lattice(ix, iz + 1)
        const d = lattice(ix + 1, iz + 1)
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
    }
    const fbm = (x, z, octaves) => {
        let sum = 0
        let amp = 0.5
        let norm = 0
        for (let i = 0; i < octaves; i++) {
            sum += amp * noise(x, z)
            norm += amp
            x = x * 2.03 + 17.1
            z = z * 2.03 - 9.7
            amp *= 0.5
        }
        return sum / norm
    }
    // Sharp crests: mountains and ridgelines.
    const ridge = (x, z, octaves) => {
        let sum = 0
        let amp = 0.5
        let norm = 0
        for (let i = 0; i < octaves; i++) {
            const n = 1 - Math.abs(2 * noise(x, z) - 1)
            sum += amp * n * n
            norm += amp
            x = x * 2.07 + 11.3
            z = z * 2.07 + 5.9
            amp *= 0.5
        }
        return sum / norm
    }
    const hash = (n, salt = 0) => lattice(n * 7 + salt * 13, n * 3 + salt * 29)

    // The valley's centre line. The glider flies towards -z.
    const pathX = (z) => 150 * Math.sin(z * 0.0019 + phase[0]) + 70 * Math.sin(z * 0.0047 + phase[1])
    const pathYaw = (z) => Math.atan(-(pathX(z + 4) - pathX(z - 4)) / 8)

    // How much of each biome there is at a distance along the valley.
    const biomeAt = (z, out = [0, 0, 0]) => {
        const d = Math.max(0, -z)
        const pos = d / SEGMENT
        const i = Math.floor(pos)
        const t = smooth(1 - BLEND / SEGMENT, 1, pos - i)
        out[0] = out[1] = out[2] = 0
        out[i % 3] += 1 - t
        out[(i + 1) % 3] += t
        return out
    }

    const w = [0, 0, 0]
    const heightAt = (x, z) => {
        biomeAt(z, w)
        const dx = Math.abs(x - pathX(z))
        const half = 70 + 45 * noise(z * 0.002, 3.7)
        const rise = smooth(half * 0.55, half * 4.6, dx)
        const detail = fbm(x * 0.021, z * 0.021, 3)
        let h = 0
        if (w[0] > 0) {
            // Karst: a river valley, steep flanks and lone limestone towers.
            const floor = -9 + 13 * noise(x * 0.008, z * 0.008)
            const flank = Math.pow(rise, 1.2) * (80 + 240 * ridge(x * 0.0031, z * 0.0031, 4))
            const cell = noise(x * 0.0105 + 31, z * 0.0105 + 17)
            const tower = smooth(0.635, 0.72, cell) * (60 + 150 * noise(x * 0.004 + 9, z * 0.004)) * (0.36 + 0.64 * rise)
            h += w[0] * (floor + flank + tower + detail * 7)
        }
        if (w[1] > 0) {
            // Dunes: long crescent crests, no water.
            const warp = 4 * noise(x * 0.004, z * 0.004)
            const crest = 1 - Math.abs(Math.sin(x * 0.017 + z * 0.006 + warp))
            const floor = 5 + 20 * crest * crest * (0.4 + noise(x * 0.003, z * 0.003))
            const flank = Math.pow(rise, 1.6) * (50 + 150 * fbm(x * 0.0028, z * 0.0028, 3))
            h += w[1] * (floor + flank + detail * 2)
        }
        if (w[2] > 0) {
            // Snow range: a frozen lake between sharp peaks.
            const floor = -4 + 7 * noise(x * 0.007, z * 0.007)
            const flank = Math.pow(rise, 1.05) * (120 + 360 * ridge(x * 0.0038, z * 0.0038, 5))
            h += w[2] * (floor + flank + detail * 12 * rise)
        }
        // Water belongs to the valley floor. Away from it the land stays dry,
        // so no stray ponds sit up on the flanks.
        h = Math.max(h, -20 + smooth(half * 1.3, half * 2.2, dx) * 22.5)
        // A calm, open launch.
        const launch = smooth(-420, -120, z)
        return mix(h, Math.min(h, -3 + rise * 60), launch)
    }

    // Lanterns hang in strings of six that dip in the middle, inviting a dive.
    const lantern = (k) => {
        const g = Math.floor(k / 6)
        const j = k % 6
        const z = -(320 + g * 340) - j * 27
        const x = pathX(z) + (hash(g, 1) - 0.5) * 80 + Math.sin(j * 0.8 + g) * 9
        const ground = Math.max(heightAt(x, z), heightAt(x, z - 14), heightAt(x, z + 14), WATER)
        const y = ground + 16 + hash(g, 2) * 34 + Math.cos((j / 5) * Math.PI * 2) * 9
        return { x, y, z, group: g }
    }

    // Thermals: columns of rising air that lift the glider.
    const thermal = (m) => {
        const z = -(700 + m * 620 + hash(m, 3) * 200)
        const x = pathX(z) + (hash(m, 4) - 0.5) * 70
        return { x, z, y: Math.max(heightAt(x, z), WATER), radius: 26 }
    }

    // Gates: tall red frames standing in the valley, to be flown through.
    // Each takes the lowest of a few spots near the centre line.
    const gateCache = new Map()
    const gate = (g) => {
        let found = gateCache.get(g)
        if (found) return found
        const z = -(900 + g * 1300 + hash(g, 5) * 300)
        let x = pathX(z)
        let y = Infinity
        for (let i = -2; i <= 2; i++) {
            const cx = pathX(z) + i * 22
            const ground = Math.max(heightAt(cx, z), heightAt(cx - 22, z), heightAt(cx + 22, z), WATER)
            if (ground < y) {
                y = ground
                x = cx
            }
        }
        found = { x, y, z, yaw: pathYaw(z) }
        gateCache.set(g, found)
        if (gateCache.size > 60) gateCache.delete(gateCache.keys().next().value)
        return found
    }

    return { seed, noise, fbm, heightAt, pathX, pathYaw, biomeAt, lantern, thermal, gate }
}

// ---- The sky through a day ---------------------------------------------
// Colours are sRGB triples in 0..1. `light` tints the land, `ink` is the
// colour of shade and of the contour lines, `mist` is the far haze.
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const KEYS = [
    { t: 0.0, top: 0x2f4678, mid: 0xf2b7a0, low: 0xfbe0bd, sun: 0xe5432d, mist: 0xf6dcc8, light: 0xffd8c2, ink: 0x2a3353, water: 0x86a8b4, elev: 0.1, glow: 0.9, stars: 0.0 },
    { t: 0.2, top: 0x3d6c98, mid: 0xb4d1d2, low: 0xf2eedb, sun: 0xfff3d6, mist: 0xe9eee2, light: 0xfff6e6, ink: 0x27425e, water: 0x5c9db6, elev: 0.62, glow: 0.35, stars: 0.0 },
    { t: 0.44, top: 0x37588f, mid: 0xf3c184, low: 0xfde6b4, sun: 0xff8436, mist: 0xf8dcae, light: 0xffd398, ink: 0x47365a, water: 0xcf9c6c, elev: 0.2, glow: 1.0, stars: 0.0 },
    { t: 0.58, top: 0x1b2350, mid: 0x7a4f74, low: 0xee8a60, sun: 0xdf4034, mist: 0xae7888, light: 0xb984a6, ink: 0x171b3d, water: 0x6b4a78, elev: 0.03, glow: 1.0, stars: 0.25 },
    { t: 0.76, top: 0x050919, mid: 0x111a40, low: 0x2b3d70, sun: 0xf4eed6, mist: 0x24335f, light: 0x6274b4, ink: 0x0a0e24, water: 0x101d47, elev: 0.48, glow: 0.3, stars: 1.0 },
    { t: 1.0, top: 0x2f4678, mid: 0xf2b7a0, low: 0xfbe0bd, sun: 0xe5432d, mist: 0xf6dcc8, light: 0xffd8c2, ink: 0x2a3353, water: 0x86a8b4, elev: 0.1, glow: 0.9, stars: 0.0 },
].map((k) => ({ ...k, top: hex(k.top), mid: hex(k.mid), low: hex(k.low), sun: hex(k.sun), mist: hex(k.mist), light: hex(k.light), ink: hex(k.ink), water: hex(k.water) }))

const COLOURS = ["top", "mid", "low", "sun", "mist", "light", "ink", "water"]

export function skyAt(time, out = {}) {
    const t = ((time % 1) + 1) % 1
    let i = 0
    while (KEYS[i + 1].t < t) i++
    const a = KEYS[i]
    const b = KEYS[i + 1]
    const f = smooth(0, 1, (t - a.t) / (b.t - a.t))
    for (const key of COLOURS) {
        const o = out[key] || (out[key] = [0, 0, 0])
        for (let c = 0; c < 3; c++) o[c] = mix(a[key][c], b[key][c], f)
    }
    out.elev = mix(a.elev, b.elev, f)
    out.glow = mix(a.glow, b.glow, f)
    out.stars = mix(a.stars, b.stars, f)
    // Between dusk and night the sun hands over to the moon.
    out.moon = smooth(0.6, 0.7, t) * (1 - smooth(0.9, 0.99, t))
    return out
}

// Land colours per biome, as they look in plain daylight.
export const LAND = {
    karst: { low: hex(0x6d9978), mid: hex(0xb2c18b), high: hex(0xdcd2aa), rock: hex(0x7d8b88), tree: hex(0x2b6a52) },
    dunes: { low: hex(0xd79a55), mid: hex(0xeab873), high: hex(0xf6d8a0), rock: hex(0xc68848), tree: hex(0x8a7a3c) },
    snow: { low: hex(0x6d8591), mid: hex(0xc0ced6), high: hex(0xf7f9fb), rock: hex(0x5a6674), tree: hex(0x23463f) },
}
