// Flights and settings live in localStorage: no accounts, no server state.
const KEY = "loft:v1"
const EVENT = "loft:storage"
const KEEP = 40
const EMPTY = { best: 0, flights: [], stamps: {}, settings: { sound: true, haptics: true, quality: "high" } }

const hasStorage = () => typeof window !== "undefined" && !!window.localStorage

export function load() {
    if (!hasStorage()) return EMPTY
    try {
        const raw = JSON.parse(window.localStorage.getItem(KEY))
        if (!raw) return EMPTY
        return { ...EMPTY, ...raw, stamps: raw.stamps || {}, flights: Array.isArray(raw.flights) ? raw.flights : [], settings: { ...EMPTY.settings, ...raw.settings } }
    } catch {
        return EMPTY
    }
}

function save(data) {
    if (!hasStorage()) return
    try {
        window.localStorage.setItem(KEY, JSON.stringify(data))
        window.dispatchEvent(new Event(EVENT))
    } catch {
        // Private mode or a full quota: the game still plays, it just forgets.
    }
}

// Record a finished flight. Returns the best distance from before it.
export function saveFlight(flight, newStamps = []) {
    const data = load()
    const stamps = { ...data.stamps }
    newStamps.forEach((s) => (stamps[s.id] = Date.now()))
    const { distance, lanterns, into, seed } = flight
    save({ ...data, stamps, best: Math.max(data.best, distance), flights: [...data.flights, { distance, lanterns, into, seed, at: Date.now() }].slice(-KEEP) })
    return data.best
}

export function saveSettings(settings) {
    const data = load()
    save({ ...data, settings: { ...data.settings, ...settings } })
}

export const STORAGE_EVENT = EVENT
export const formatMetres = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
