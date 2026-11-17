// Server lifecycle hooks, in the order Catalyst calls them.
// Docs: https://catalyst.1mg.com/content/API%20Reference/ssr-lifecycle

// Runs once before the server starts. Catalyst waits for it.
export const preServerInit = () => {
    console.log("[loft] ready")
}

// Request hooks are not awaited, so they stay synchronous.

export const onFetcherError = ({ req, error }) => {
    console.error(`[loft] fetcher failed for ${req.originalUrl}:`, error?.message || error)
}

export const onRenderError = ({ req, error }) => {
    console.error(`[loft] render failed for ${req.originalUrl}:`, error?.message || error)
}

export const onRequestError = ({ req, error }) => {
    console.error(`[loft] request failed for ${req.originalUrl}:`, error?.message || error)
}
