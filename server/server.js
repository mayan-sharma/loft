import express from "express"
import path from "path"
import expressStaticGzip from "express-static-gzip"

// Server middlewares are added here. Catalyst mounts them before its own
// page handler, so these routes answer before any React render.
export function addMiddlewares(app) {
    if (process.env.NODE_ENV === "production") {
        app.use(
            `${process.env.PUBLIC_STATIC_ASSET_PATH}/client`,
            expressStaticGzip(path.join(__dirname, `../${process.env.BUILD_OUTPUT_PATH}/client`), {
                enableBrotli: true,
                orderPreference: ["br", "gz"],
                serveStatic: { maxAge: "1y", etag: true },
            })
        )
    }
    app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")))
    app.use("/icon.png", express.static(path.join(__dirname, "../public/icon.png")))
    app.use("/apple-touch-icon.png", express.static(path.join(__dirname, "../public/apple-touch-icon.png")))

    app.get("/api/health", (req, res) => res.json({ ok: true }))
}
