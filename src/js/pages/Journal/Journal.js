import React from "react"
import { Link } from "react-router"
import Seal from "../../components/Seal/Seal"
import { STAMPS } from "../../game/stamps"
import { formatMetres, saveSettings } from "../../game/storage"
import { useSaved } from "../../game/useSaved"
import css from "../page.scss"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const day = (ms) => {
    const d = new Date(ms)
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

function Choice({ label, detail, value, options, onChange }) {
    return (
        <div className={css.choice}>
            <div>
                <strong>{label}</strong>
                <small>{detail}</small>
            </div>
            <div className={css.options} role="group" aria-label={label}>
                {options.map(([v, text]) => (
                    <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
                        {text}
                    </button>
                ))}
            </div>
        </div>
    )
}

function Journal() {
    const saved = useSaved()
    const flights = saved ? [...saved.flights].reverse() : []
    const total = flights.reduce((sum, f) => sum + f.distance, 0)
    const lanterns = flights.reduce((sum, f) => sum + f.lanterns, 0)
    const settings = saved?.settings

    return (
        <main className={css.page}>
            <Link to="/" className={css.back}>
                ← Back to the valley
            </Link>
            <h1 className={css.title}>Journal</h1>
            <p className={css.lede}>Every flight from this device. Nothing is sent anywhere.</p>

            <dl className={css.figures}>
                <div>
                    <dt>Longest</dt>
                    <dd>{saved ? formatMetres(saved.best) : "–"} m</dd>
                </div>
                <div>
                    <dt>Flights</dt>
                    <dd>{saved ? flights.length : "–"}</dd>
                </div>
                <div>
                    <dt>Flown in all</dt>
                    <dd>{saved ? formatMetres(total) : "–"} m</dd>
                </div>
                <div>
                    <dt>Lanterns lit</dt>
                    <dd>{saved ? lanterns : "–"}</dd>
                </div>
            </dl>

            <h2 className={css.h2}>
                Stamps{saved ? ` · ${Object.keys(saved.stamps).length} of ${STAMPS.length}` : ""}
            </h2>
            <ul className={css.stamps}>
                {STAMPS.map((s) => {
                    const have = !!saved?.stamps[s.id]
                    return (
                        <li key={s.id} data-have={have || undefined}>
                            <Seal size={34} />
                            <span>
                                <strong>{s.name}</strong>
                                <small>{s.how}</small>
                            </span>
                        </li>
                    )
                })}
            </ul>

            <h2 className={css.h2}>Flights</h2>
            {saved && flights.length === 0 && <p className={css.lede}>No flights yet. The first one is waiting.</p>}
            <ol className={css.flights}>
                {flights.slice(0, 20).map((f) => (
                    <li key={f.at}>
                        <span>{day(f.at)}</span>
                        <Link to={`/v/${f.seed}`}>valley {f.seed}</Link>
                        <span>{f.lanterns} lit</span>
                        <b>{formatMetres(f.distance)} m</b>
                    </li>
                ))}
            </ol>

            <h2 className={css.h2}>Settings</h2>
            <Choice
                label="Sound"
                detail="Wind, a low drone and plucked notes"
                value={settings?.sound ?? true}
                options={[
                    [true, "On"],
                    [false, "Off"],
                ]}
                onChange={(sound) => saveSettings({ sound })}
            />
            <Choice
                label="Haptics"
                detail="A tap for lanterns and skims, a thud on landing"
                value={settings?.haptics ?? true}
                options={[
                    [true, "On"],
                    [false, "Off"],
                ]}
                onChange={(haptics) => saveSettings({ haptics })}
            />
            <Choice
                label="Detail"
                detail="Lower it if the flight stutters. Applies from the next visit to the valley"
                value={settings?.quality ?? "high"}
                options={[
                    ["high", "Full"],
                    ["low", "Light"],
                ]}
                onChange={(quality) => saveSettings({ quality })}
            />
        </main>
    )
}

Journal.setMetaData = () => [<title key="t">Journal · Loft</title>]

export default Journal
