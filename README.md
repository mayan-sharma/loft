# Loft

A paper plane, a valley, and one long day. Loft is an endless flight through a woodblock-print landscape, built with [Catalyst](https://catalyst.1mg.com). Dive for speed, let go to rise, skim the water, light the lanterns, and see how far the day takes you.

**Fly it: https://loft-uen1.onrender.com**

One codebase ships as a server-rendered website, an installable offline web app, and Android and iOS apps.

```bash
npm install
npm start          # dev server on http://localhost:3013
npm run build      # production build
npm run serve      # serve the production build
npm run buildApp:android
npm run buildApp:ios
```

## Flying

- Touch and drag down to dive; let go to rise on the speed you have. Drag sideways to steer. Keyboard: arrow keys, with down or space to dive.
- Lanterns give speed and lift. Columns of drifting petals are rising air. Red gates give a push when you fly through them. Flying fast and very low is a skim, which builds speed.
- Twelve stamps are the goals: distances, the three countries, strings of lanterns, gates, skimming, flying after dark.
- The flight ends when the plane touches the land or the water.

## How it is made

- **No assets.** Nothing is modelled, painted or downloaded. The land, sky, water, trees and sound are all generated in code.
- **The world** (`src/js/game/world.js`) is a pure function of a seed: a winding valley, three kinds of country (river karst, dunes, snow range) that blend into each other, strings of lanterns and thermals. A link like `/v/4242` opens the same valley for anyone.
- **Flight** (`src/js/game/flight.js`) is a pure step function trading height for speed, so it can be tested without a browser.
- **The picture** (`src/js/game/scene.js`) is three.js with hand-written shaders, aiming for a print you can fly through:
  - land coloured in flat bands by height, with wobbly hand-cut edges, ink shade and contour lines;
  - cliffs brushed with vertical strokes;
  - trees as dabs of paint (point sprites), not models;
  - mist that pools in the valley and far ridges that fade into the horizon colour;
  - a flat sun the valley always leads towards, banded clouds, and a broken stripe of light on the water;
  - a day that runs dawn, noon, golden hour, dusk, night and back, by blending palettes.
  - A paper grain is multiplied over the canvas in CSS.
- **Sound** (`src/js/game/sound.js`) is synthesised: wind that follows the speed, a drone, and plucked pentatonic notes.

## Catalyst features used

| Feature | Where |
| --- | --- |
| SSR with `serverFetcher` / `clientFetcher` | The fetcher picks the valley (or reads it from `/v/:seed`), so the title page is server-rendered and three.js loads only after hydration. |
| `split()` routes with inlined CSS | `src/js/routes/index.js` |
| `setMetaData` + `MetaTag` | Titles and Open Graph tags, including per shared valley. |
| `offline: true` routes | The whole flight works offline once opened. |
| `useHapticFeedback` | Lanterns, skims, thermals and the landing. |
| `useSafeArea`, `useNetworkStatus`, `useDeviceInfo` | Instrument padding, the offline badge, the About page. |
| WebMCP `useTool` | `loft_flight_status`, `loft_begin_flight` |
| Server middlewares and lifecycle hooks | `server/server.js`, `server/index.js` |
| HTML splash screen, edge to edge | `public/splashscreen.html`, `config/config.json` |

## Deploying

`render.yaml` is a Render Blueprint for the free plan. Catalyst listens on `NODE_SERVER_PORT` from `config/config.json` (3013), so the Blueprint sets `PORT` to match.
