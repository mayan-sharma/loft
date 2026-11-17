// Flight as a pure step function. The glider trades height for speed in a
// dive and speed for height when released; lift comes from lanterns,
// thermals and skimming close to the ground.
import { WATER } from "./world"

export const CRUISE = 34
const G = 30
const DRAG = 0.0019
const STALL = 22
const CEILING = 300

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt))

export function newFlight(world) {
    const z = -40
    const x = world.pathX(z)
    return {
        x,
        y: 95,
        z,
        speed: 46,
        pitch: -0.05,
        yaw: world.pathYaw(z),
        roll: 0,
        agl: 95,
        time: 0,
        distance: 0,
        lanterns: 0,
        combo: 0,
        skim: 0, // seconds of the current skim
        skimTotal: 0,
        lift: 0,
        nextLantern: 0,
        nextThermal: 0,
        nextGate: 0,
        gates: 0,
        bestCombo: 0,
        over: null,
    }
}

/**
 * Advance the flight. `input` is { dive: 0..1, steer: -1..1 }.
 * Returns the events of this step: lantern, skim, thermal, crash.
 */
export function stepFlight(s, input, dt, world, events = []) {
    if (s.over) return events
    s.time += dt

    // Pitch: hold to dive; let go and the nose rises with the speed in hand.
    const dive = clamp(Number(input.dive) || 0, 0, 1)
    let target = s.speed < STALL ? -0.28 : clamp(((s.speed - CRUISE) / CRUISE) * 0.95 - 0.07, -0.09, 0.52)
    target += (-0.66 - target) * dive
    if (s.y > CEILING - 60) target = Math.min(target, (CEILING - s.y) / 120 - 0.1)
    s.pitch = approach(s.pitch, target, 2.1 + dive * 1.1, dt)

    // Heading follows the valley; steering leans away from its centre line.
    const steer = clamp(input.steer || 0, -1, 1)
    const wanted = world.pathYaw(s.z) + steer * 0.62
    s.yaw = approach(s.yaw, wanted, 2.6, dt)
    s.roll = approach(s.roll, -steer * 0.75 - (wanted - s.yaw) * 1.4, 5, dt)

    // Energy.
    s.speed += (-G * Math.sin(s.pitch) - DRAG * s.speed * s.speed) * dt
    s.speed = Math.max(s.speed, 12)

    const cp = Math.cos(s.pitch)
    const vx = Math.sin(s.yaw) * cp * s.speed
    const vy = Math.sin(s.pitch) * s.speed + s.lift
    const vz = -Math.cos(s.yaw) * cp * s.speed
    s.x += vx * dt
    s.y += vy * dt
    s.z += vz * dt
    s.distance = Math.max(s.distance, -s.z - 40)
    s.lift = approach(s.lift, 0, 1.4, dt)

    const ground = Math.max(world.heightAt(s.x, s.z), WATER)
    s.agl = s.y - ground

    // Skimming: flying fast and very low is rewarded with speed.
    if (s.agl < 9 && s.speed > 38) {
        if (s.skim === 0) events.push({ type: "skim" })
        s.skim += dt
        s.skimTotal += dt
        s.speed += 9 * dt
    } else {
        s.skim = 0
    }

    // Lanterns ahead of us, in order.
    for (let k = s.nextLantern; k < s.nextLantern + 12; k++) {
        const l = world.lantern(k)
        if (l.z > s.z + 30) {
            if (k === s.nextLantern) {
                s.nextLantern = k + 1
                s.combo = 0
            }
            continue
        }
        if (l.z < s.z - 30) break
        const dx = l.x - s.x
        const dy = l.y - s.y
        const dz = l.z - s.z
        if (dx * dx + dy * dy + dz * dz < 9 * 9 && !s[`got${k}`]) {
            s[`got${k}`] = true
            s.lanterns += 1
            s.combo += 1
            s.bestCombo = Math.max(s.bestCombo, s.combo)
            s.speed += 5
            s.lift += 4
            events.push({ type: "lantern", k, combo: s.combo, x: l.x, y: l.y, z: l.z })
        }
    }

    // Thermals.
    for (let m = s.nextThermal; m < s.nextThermal + 3; m++) {
        const t = world.thermal(m)
        if (t.z > s.z + 60) {
            if (m === s.nextThermal) s.nextThermal = m + 1
            continue
        }
        const dx = t.x - s.x
        const dz = t.z - s.z
        if (dx * dx + dz * dz < t.radius * t.radius) {
            if (s.lift < 6) events.push({ type: "thermal" })
            s.lift = approach(s.lift, 24, 3, dt)
            s.speed = Math.max(s.speed, CRUISE + 6)
        }
    }

    // Gates: pass between the posts and under the beam for a push.
    const gate = world.gate(s.nextGate)
    if (s.z < gate.z) {
        const dy = s.y - gate.y
        if (Math.abs(s.x - gate.x) < 21 && dy > 2 && dy < 37) {
            s.gates += 1
            s.speed += 14
            s.lift += 7
            events.push({ type: "gate", count: s.gates })
        }
        s.nextGate += 1
    }

    if (s.agl <= 0.7) {
        s.over = ground <= WATER + 0.01 ? "water" : "land"
        events.push({ type: "crash", into: s.over })
    }
    return events
}

// A simple pilot for the title screen and for tests: hold a height band,
// follow the valley and steer away from rising ground.
export function autopilot(s, world) {
    const ahead = 60
    const fx = s.x + Math.sin(s.yaw) * ahead
    const fz = s.z - Math.cos(s.yaw) * ahead
    const groundAhead = Math.max(world.heightAt(fx, fz), world.heightAt(s.x, s.z - 25), WATER)
    const left = world.heightAt(fx - 45, fz)
    const right = world.heightAt(fx + 45, fz)
    const off = (world.pathX(s.z) - s.x) / 60
    const steer = clamp(off + clamp((left - right) / 60, -1, 1) * 0.8, -1, 1)
    return { dive: s.y - groundAhead > 75 && s.speed < 60 ? 1 : 0, steer }
}
