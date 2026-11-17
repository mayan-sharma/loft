import React, { useEffect, useState } from "react"
import { Link } from "react-router"
import { useCurrentRouteData } from "catalyst-core"
import { useDeviceInfo, useHapticFeedback, useNetworkStatus, useSafeArea } from "catalyst-core/hooks"
import css from "../page.scss"

const Row = ({ name, hook, value }) => (
    <li>
        <span>
            <strong>{name}</strong>
            <code>{hook}</code>
        </span>
        <em>{value}</em>
    </li>
)

function UnderTheHood({ renderedOn }) {
    const device = useDeviceInfo()
    const network = useNetworkStatus()
    const insets = useSafeArea()
    const haptics = useHapticFeedback()
    // Everything here depends on the browser or the shell, so it shows after hydration.
    const [client, setClient] = useState(null)
    useEffect(() => {
        const canvas = document.createElement("canvas")
        setClient({ sw: "serviceWorker" in navigator && !!navigator.serviceWorker.controller, webgl: !!canvas.getContext("webgl2") })
    }, [])
    const ready = client !== null
    const shell = device.isNative ? `Native ${device.data?.platform || "app"}` : "Web browser"

    return (
        <ul className={css.hood}>
            <Row name="This page" hook="serverFetcher · split()" value={renderedOn === "server" ? "Rendered on the server" : "Rendered in the browser"} />
            <Row name="Shell" hook="useDeviceInfo" value={ready ? shell : "…"} />
            <Row name="Network" hook="useNetworkStatus" value={!ready ? "…" : network.online ? "Online" : "Offline"} />
            <Row name="Safe area" hook="useSafeArea" value={`${insets.top || 0} / ${insets.right || 0} / ${insets.bottom || 0} / ${insets.left || 0}`} />
            <Row name="Haptics" hook="useHapticFeedback" value={!ready ? "…" : haptics.isNative ? "Native" : haptics.isSupported ? "Vibration API" : "Not on this device"} />
            <Row name="Offline" hook="offline: true" value={!ready ? "…" : device.isNative ? "Native route cache" : client.sw ? "Service worker active" : "Not active in this browser"} />
            <Row name="3D" hook="three.js, loaded after hydration" value={!ready ? "…" : client.webgl ? "WebGL 2" : "Not available"} />
        </ul>
    )
}

function About() {
    const { data } = useCurrentRouteData()
    return (
        <main className={css.page}>
            <Link to="/" className={css.back}>
                ← Back to the valley
            </Link>
            <h1 className={css.title}>About</h1>
            <p className={css.lede}>
                Loft is a flight through a print that never ends. A paper plane, a valley that leads towards the sun, and a day that turns from dawn to
                night and back while you fly.
            </p>

            <h2 className={css.h2}>Flying</h2>
            <ol className={css.steps}>
                <li>Touch and drag down to dive. Diving turns height into speed.</li>
                <li>Let go and the plane rises on the speed it has, then settles into a slow glide.</li>
                <li>Drag sideways to steer. On a keyboard: arrow keys, with down or space to dive.</li>
                <li>Lanterns give a little speed and lift. Each one in a string plays the next note up.</li>
                <li>Columns of drifting petals are rising air. Fly through one to be carried up.</li>
                <li>Fly fast and very low to skim. Skimming builds speed, and it is where flights end.</li>
            </ol>

            <h2 className={css.h2}>The valley</h2>
            <p className={css.lede}>
                Nothing is drawn by hand and nothing is downloaded. The land is generated from a number, so a shared link opens the same valley for someone
                else. River country gives way to dunes, then to snow, then round again.
            </p>

            <h2 className={css.h2}>Under the hood</h2>
            <p className={css.lede}>One React codebase built with Catalyst: this website, and Android and iOS apps from the same pages.</p>
            <UnderTheHood renderedOn={data?.renderedOn} />
        </main>
    )
}

About.serverFetcher = () => Promise.resolve({ renderedOn: "server" })
About.clientFetcher = () => Promise.resolve({ renderedOn: "client" })
About.setMetaData = () => [<title key="t">About · Loft</title>]

export default About
