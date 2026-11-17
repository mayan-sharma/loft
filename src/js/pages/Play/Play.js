import React from "react"
import { useCurrentRouteData } from "catalyst-core"
import Flight from "../../components/Flight/Flight"

// The fetcher only chooses the valley. A shared link (/v/:seed) names one;
// otherwise the server picks, so the first paint already knows where it is.
function fetchValley({ params }) {
    const asked = Number(params?.seed)
    const shared = Number.isInteger(asked) && asked >= 0 && asked <= 0xffffff
    return Promise.resolve({ seed: shared ? asked : Math.floor(Math.random() * 0xffffff), shared })
}

function Play() {
    const { data } = useCurrentRouteData()
    if (!data) return null
    return <Flight key={data.seed} seed={data.seed} />
}

Play.serverFetcher = fetchValley
Play.clientFetcher = fetchValley

Play.setMetaData = (routeData) => {
    const data = Object.values(routeData || {})
        .map((entry) => entry?.data)
        .find((d) => d && d.seed !== undefined)
    const title = data?.shared ? `Loft · valley ${data.seed}` : "Loft · a paper plane, a valley, one long day"
    const description = "Glide a paper plane through an endless woodblock-print valley, from dawn through dusk into night. Dive for speed, skim the water, light the lanterns."
    return [
        <title key="t">{title}</title>,
        <meta key="d" name="description" content={description} />,
        <meta key="ogt" property="og:title" content={title} />,
        <meta key="ogd" property="og:description" content={description} />,
        <meta key="ogi" property="og:image" content="/icon.png" />,
        <meta key="tc" name="theme-color" content="#2f4678" />,
    ]
}

export default Play
