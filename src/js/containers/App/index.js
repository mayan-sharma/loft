import React, { useEffect, useState } from "react"
import { Outlet } from "react-router"
import { useNetworkStatus, useSafeArea } from "catalyst-core/hooks"
import css from "./App.scss"

const App = () => {
    const insets = useSafeArea()
    const { online } = useNetworkStatus()
    // Cached pages are rendered online, so the badge waits for hydration.
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    // Native insets arrive as request headers, so even the server render
    // pads for the notch and the home indicator.
    const shellStyle = {
        "--inset-top": `${insets.top || 0}px`,
        "--inset-bottom": `${insets.bottom || 0}px`,
        "--inset-left": `${insets.left || 0}px`,
        "--inset-right": `${insets.right || 0}px`,
    }

    return (
        <div className={css.shell} style={shellStyle}>
            {mounted && !online && (
                <span className={css.offline} role="status">
                    Offline
                </span>
            )}
            <Outlet />
        </div>
    )
}

App.serverSideFunction = () => Promise.resolve()

export default App
