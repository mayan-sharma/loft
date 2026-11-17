import React, { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useHapticFeedback } from "catalyst-core/hooks"
import { useTool } from "catalyst-core/webmcp"
import Seal from "../Seal/Seal"
import { mute, play, setFlightSound, startAmbience } from "../../game/sound"
import { formatMetres, load, saveFlight, saveSettings } from "../../game/storage"
import { earnedBy } from "../../game/stamps"
import { useSaved } from "../../game/useSaved"
import css from "./Flight.scss"

const STICK = 74 // pixels of drag for full deflection
const randomSeed = () => Math.floor(Math.random() * 0xffffff)

/**
 * The game: a full-bleed canvas with the title, the instruments and the
 * landing card laid over it. The renderer (three.js) is loaded after
 * hydration, so the server sends the title page and no 3D code.
 */
export default function Flight({ seed }) {
    const canvasRef = useRef(null)
    const api = useRef(null)
    const seedRef = useRef(seed)
    const modeRef = useRef("attract")
    const keys = useRef({})
    const drag = useRef(null)
    const noteTimer = useRef(0)
    const log = useRef({ sawNight: false, seconds: 0 })
    const hintTimers = useRef([])
    const [mode, setModeState] = useState("attract")
    const [ready, setReady] = useState(false)
    const [failed, setFailed] = useState(false)
    const [hud, setHud] = useState({ distance: 0, lanterns: 0 })
    const [note, setNote] = useState(null)
    const [stick, setStick] = useState(null)
    const [result, setResult] = useState(null)
    const [copied, setCopied] = useState(false)
    const saved = useSaved()
    const soundOn = saved ? saved.settings.sound : true
    const haptics = useHapticFeedback()
    const hapticsRef = useRef(haptics)
    hapticsRef.current = haptics

    const setMode = (next) => {
        modeRef.current = next
        setModeState(next)
    }

    const buzz = (type) => {
        if (!load().settings.haptics) return
        try {
            hapticsRef.current.execute?.(type)
        } catch {
            // No haptics here; the flight does not need them.
        }
    }
    const sound = (name, options) => load().settings.sound && play(name, options)

    const say = (text, ms = 1600) => {
        setNote({ text, key: Date.now(), ms })
        clearTimeout(noteTimer.current)
        noteTimer.current = setTimeout(() => setNote(null), ms)
    }

    // ---- The renderer ---------------------------------------------------
    useEffect(() => {
        let disposed = false
        let scene = null
        const onResize = () => scene?.resize()
        // In the background the clock stops and the sound goes quiet.
        const onHide = () => {
            scene?.pause(document.hidden)
            if (document.hidden) mute()
        }

        const onEvent = (e, flight) => {
            if (e.type === "lantern") {
                sound("lantern", { combo: e.combo })
                buzz("light")
                say(e.combo > 1 ? `Lantern × ${e.combo}` : "Lantern")
            } else if (e.type === "skim") {
                sound("skim")
                buzz("light")
                say("Skimming")
            } else if (e.type === "gate") {
                sound("gate")
                buzz("heavy")
                say(e.count > 1 ? `Gate × ${e.count}` : "Through the gate")
            } else if (e.type === "thermal") {
                sound("thermal")
                buzz("medium")
                say("Rising air")
            } else if (e.type === "crash") {
                sound("crash")
                buzz("heavy")
                mute()
                hintTimers.current.forEach(clearTimeout)
                const flown = {
                    distance: Math.round(flight.distance),
                    lanterns: flight.lanterns,
                    gates: flight.gates,
                    bestCombo: flight.bestCombo,
                    skimSeconds: flight.skimSeconds,
                    sawNight: log.current.sawNight,
                    seconds: log.current.seconds,
                    into: e.into,
                    seed: seedRef.current,
                }
                const stamps = earnedBy(flown, load().stamps)
                const before = saveFlight(flown, stamps)
                if (stamps.length) setTimeout(() => sound("stamp"), 1500)
                setResult({ ...flown, stamps, best: Math.max(before, flown.distance), isBest: flown.distance > before && before > 0 })
                setNote(null)
                setMode("over")
            }
        }
        const onFrame = (f) => {
            setHud((h) => (h.distance === Math.round(f.distance) && h.lanterns === f.lanterns ? h : { distance: Math.round(f.distance), lanterns: f.lanterns }))
            if (f.mode === "flying") {
                log.current.seconds += 0.1
                if (f.time > 0.68 && f.time < 0.92) log.current.sawNight = true
                if (load().settings.sound) setFlightSound(f.speed, Math.max(0, 1 - f.agl / 25), true)
            }
        }

        import("../../game/scene")
            .then(({ createScene }) => {
                if (disposed) return
                scene = createScene(canvasRef.current, { seed: seedRef.current, quality: load().settings.quality, onEvent, onFrame })
                api.current = scene
                window.addEventListener("resize", onResize)
                document.addEventListener("visibilitychange", onHide)
                window.__loft = scene
                setReady(true)
            })
            .catch((error) => {
                console.error("[loft] could not start the renderer:", error)
                setFailed(true)
            })

        return () => {
            disposed = true
            window.removeEventListener("resize", onResize)
            document.removeEventListener("visibilitychange", onHide)
            hintTimers.current.forEach(clearTimeout)
            scene?.dispose()
            api.current = null
            mute()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const begin = useCallback((fresh) => {
        if (!api.current || modeRef.current === "flying") return false
        if (fresh) {
            seedRef.current = randomSeed()
            api.current.reset(seedRef.current)
        }
        api.current.begin()
        log.current = { sawNight: false, seconds: 0 }
        setResult(null)
        setMode("flying")
        // The very first flight is talked through.
        hintTimers.current.forEach(clearTimeout)
        if (load().flights.length === 0) {
            const hint = (ms, text) => setTimeout(() => modeRef.current === "flying" && say(text, 3200), ms)
            hintTimers.current = [hint(600, "Drag down to dive"), hint(5200, "Let go, and rise on your speed"), hint(10500, "Drag sideways to steer"), hint(16500, "Lanterns and gates give you speed")]
        }
        if (load().settings.sound) {
            startAmbience()
            play("begin")
        }
        return true
    }, [])

    // ---- Input: one thumb as a stick, or the keyboard --------------------
    const pushInput = () => {
        const k = keys.current
        const d = drag.current
        const steer = (k.right ? 1 : 0) - (k.left ? 1 : 0) + (d ? d.steer : 0)
        const dive = Math.max(k.dive ? 1 : 0, d ? d.dive : 0)
        api.current?.setInput({ steer: Math.max(-1, Math.min(1, steer)), dive })
    }

    const onPointerDown = (e) => {
        if (e.target.closest("a, button")) return
        if (modeRef.current === "attract") begin(false)
        if (modeRef.current !== "flying") return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, steer: 0, dive: 0 }
        setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
    }
    const onPointerMove = (e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        const dx = Math.max(-STICK, Math.min(STICK, e.clientX - d.x))
        const dy = Math.max(0, Math.min(STICK, e.clientY - d.y))
        d.steer = dx / STICK
        d.dive = dy / STICK
        setStick({ x: d.x, y: d.y, dx, dy })
        pushInput()
    }
    const onPointerUp = (e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        drag.current = null
        setStick(null)
        pushInput()
    }

    useEffect(() => {
        const map = { ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right", ArrowDown: "dive", s: "dive", " ": "dive" }
        const onKey = (e) => {
            const name = map[e.key]
            const down = e.type === "keydown"
            if (down && (e.key === "Enter" || e.key === " ") && modeRef.current !== "flying" && !e.target.closest?.("a, button")) {
                e.preventDefault()
                begin(modeRef.current === "over")
                return
            }
            if (!name) return
            if (modeRef.current === "flying") e.preventDefault()
            keys.current[name] = down
            pushInput()
        }
        window.addEventListener("keydown", onKey)
        window.addEventListener("keyup", onKey)
        return () => {
            window.removeEventListener("keydown", onKey)
            window.removeEventListener("keyup", onKey)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [begin])

    const toggleSound = () => {
        saveSettings({ sound: !soundOn })
        if (soundOn) mute()
        else if (modeRef.current === "flying") startAmbience()
    }

    const share = async () => {
        const url = `${window.location.origin}/v/${result.seed}`
        const text = `I flew ${formatMetres(result.distance)} m through this valley in Loft and lit ${result.lanterns} lanterns.`
        try {
            if (navigator.share) {
                await navigator.share({ text, url })
                return
            }
            await navigator.clipboard.writeText(`${text}\n${url}`)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch {
            // Share sheet dismissed or clipboard blocked: nothing to do.
        }
    }

    // ---- WebMCP ----------------------------------------------------------
    useTool(
        {
            name: "loft_flight_status",
            description:
                "Read the state of the Loft flight: mode (attract, flying or over), metres flown, lanterns lit, speed, " +
                "height above the ground and the time of day from 0 to 1.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true },
            execute: async () => {
                const s = api.current?.state()
                if (!s) return { ready: false }
                return { ready: true, mode: s.mode, metres: Math.round(s.distance), lanterns: s.lanterns, speed: Math.round(s.speed), heightAboveGround: Math.round(s.agl), timeOfDay: Number(s.time.toFixed(2)) }
            },
        },
        []
    )
    useTool(
        {
            name: "loft_begin_flight",
            description: "Start a flight in Loft. After a landing this starts a new flight in a new valley.",
            inputSchema: { type: "object", properties: {} },
            execute: async () => ({ ok: begin(modeRef.current === "over") }),
        },
        [begin]
    )

    const best = saved?.best ?? 0

    return (
        <div
            className={css.stage}
            data-mode={mode}
            data-ready={ready || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            <canvas ref={canvasRef} className={css.canvas} aria-label="A paper plane gliding through a valley" />
            <div className={css.grain} aria-hidden="true" />

            {mode === "attract" && (
                <div className={css.title}>
                    <div className={css.mast}>
                        <Seal size={46} />
                        <h1 className={css.name}>Loft</h1>
                        <p className={css.tagline}>A paper plane, a valley, and one long day.</p>
                    </div>
                    <div className={css.foot}>
                        {failed ? (
                            <p className={css.begin}>This device could not start the 3D view.</p>
                        ) : (
                            <>
                                <p className={css.begin}>{ready ? "Touch anywhere to fly" : "Unfolding the valley…"}</p>
                                <p className={css.how}>Drag down to dive · sideways to steer · let go to rise</p>
                            </>
                        )}
                        <nav className={css.links} aria-label="Pages">
                            <Link to="/journal">Journal</Link>
                            <span aria-hidden="true">·</span>
                            <Link to="/about">About</Link>
                            {best > 0 && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>Best {formatMetres(best)} m</span>
                                </>
                            )}
                        </nav>
                    </div>
                </div>
            )}

            {mode !== "attract" && (
                <div className={css.hud}>
                    <p className={css.metres} aria-live="off">
                        {formatMetres(hud.distance)}
                        <small>m</small>
                    </p>
                    <div className={css.right}>
                        <p className={css.lanterns} aria-label={`${hud.lanterns} lanterns`}>
                            <svg width="17" height="24" viewBox="0 0 17 24" aria-hidden="true">
                                <path d="M5 2.5h7M8.5 0v2.5M8.5 19v5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                                <path d="M5.5 3.5h6c3 2.6 4 5.2 4 7.5s-1 4.9-4 7.500h-6c-3-2.600-4-5.200-4-7.500s1-4.900 4-7.500Z" fill="#ffb347" />
                            </svg>{" "}
                            {hud.lanterns}
                        </p>
                        <button type="button" className={css.sound} onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "Turn sound off" : "Turn sound on"}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" />
                                {soundOn ? <path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" /> : <path d="m16 9.500 5 5M21 9.500l-5 5" />}
                            </svg>
                        </button>
                    </div>
                </div>
            )}

            {mode === "flying" && note && (
                <p className={css.note} key={note.key} style={{ animationDuration: `${note.ms}ms` }} aria-live="polite">
                    {note.text}
                </p>
            )}

            {stick && (
                <div className={css.stick} style={{ left: stick.x, top: stick.y }} aria-hidden="true">
                    <i style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
                </div>
            )}

            {mode === "over" && result && (
                <div className={css.card} role="dialog" aria-labelledby="landing-title">
                    <p className={css.kicker} id="landing-title">
                        {result.isBest ? "Your longest flight" : result.into === "water" ? "Down on the water" : "Down in the valley"}
                    </p>
                    <p className={css.flown}>
                        {formatMetres(result.distance)}
                        <small>m</small>
                    </p>
                    <p className={css.meta}>
                        {result.lanterns} lantern{result.lanterns === 1 ? "" : "s"} lit
                        {result.gates > 0 ? ` · ${result.gates} gate${result.gates === 1 ? "" : "s"}` : ""} · best {formatMetres(result.best)} m
                    </p>
                    {result.stamps.length > 0 && (
                        <ul className={css.stamps} aria-label="New stamps">
                            {result.stamps.map((s, i) => (
                                <li key={s.id} style={{ "--i": i }}>
                                    <Seal size={30} />
                                    <span>{s.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className={css.actions}>
                        <button type="button" className={css.primary} onClick={() => begin(true)}>
                            Fly again
                        </button>
                        <button type="button" className={css.secondary} onClick={share}>
                            {copied ? "Copied" : "Share this valley"}
                        </button>
                    </div>
                    <nav className={css.links} aria-label="Pages">
                        <Link to="/journal">Journal</Link>
                        <span aria-hidden="true">·</span>
                        <Link to="/about">About</Link>
                    </nav>
                </div>
            )}
        </div>
    )
}
