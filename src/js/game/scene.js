// The renderer. Everything here is three.js and runs only in the browser;
// the React shell loads this file with a dynamic import after hydration.
//
// The look is a woodblock print you can fly through: flat bands of colour,
// ink shade and contour lines, far ridges fading into printed mist, and a
// large flat sun the valley always leads towards.
import * as THREE from "three"
import { makeWorld, skyAt, LAND, BIOMES, WATER } from "./world"
import { newFlight, stepFlight, autopilot } from "./flight"

THREE.ColorManagement.enabled = false

const CHUNK = 256
const AHEAD = 8
const BEHIND = 1
const SIDE = 3
const FOG_FAR = 1900

// ---- Shared GLSL --------------------------------------------------------
const NOISE = /* glsl */ `
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) {
    return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.3) + 0.2 * vnoise(p * 4.3 - 3.1);
}`

const AIR = /* glsl */ `
uniform vec3 uMist;
uniform vec3 uHaze;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform float uFogFar;
uniform float uGlow;
uniform float uTime;
float airHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float airNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(airHash(i), airHash(i + vec2(1, 0)), u.x), mix(airHash(i + vec2(0, 1)), airHash(i + vec2(1, 1)), u.x), u.y);
}
// Atmospheric perspective. Mist pools low in the valley in drifting banks,
// everything far away dissolves into the horizon colour, and air between
// the eye and the sun glows with the sun's own light.
vec3 applyAir(vec3 col, vec3 wpos) {
    vec3 ray = wpos - cameraPosition;
    float d = length(ray);
    float toward = max(dot(ray / d, uSun), 0.0);
    vec3 glow = uSunCol * uGlow * min(pow(toward, 5.0) * 0.3 + pow(toward, 36.0) * 0.38, 0.42);
    float bank = airNoise(wpos.xz * 0.0032 + vec2(uTime * 0.012, 0.0));
    float pool = exp(-max(wpos.y - 3.0, 0.0) * mix(0.011, 0.034, bank));
    // The mist is printed in a few flat washes, not a smooth blur.
    float wash = pool * smoothstep(70.0, 800.0, d) * 0.8;
    float band = wash * 4.0;
    wash = (floor(band) + smoothstep(0.3, 0.7, fract(band))) / 4.0;
    col = mix(col, uMist + glow * 0.7, wash);
    float f = 1.0 - exp(-pow(d / uFogFar, 1.6) * 2.4);
    return mix(col, uHaze + glow, f);
}`

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2])
const landUniform = (key) => BIOMES.map((b) => v3(LAND[b][key]))

export function createScene(canvas, { seed, quality = "high", onEvent = () => {}, onFrame = () => {} }) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 6000)
    let RES = quality === "low" ? 20 : 40

    // Uniforms shared by every material: the light of the hour.
    const shared = {
        uMist: { value: new THREE.Vector3() },
        uHaze: { value: new THREE.Vector3() },
        uFogFar: { value: FOG_FAR },
        uSun: { value: new THREE.Vector3(0.2, 0.3, -1).normalize() },
        uSunCol: { value: new THREE.Vector3() },
        uLight: { value: new THREE.Vector3() },
        uInk: { value: new THREE.Vector3() },
        uGlow: { value: 0 },
        uTime: { value: 0 },
    }

    const skyTop = { value: new THREE.Vector3() }
    const skyMid = { value: new THREE.Vector3() }

    // ---- Sky -----------------------------------------------------------
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: {
            ...shared,
            uTop: skyTop,
            uMid: skyMid,
            uAurora: { value: 0 },
            uLow: { value: new THREE.Vector3() },
            uStars: { value: 0 },
            uMoon: { value: 0 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vDir = position;
                vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = p.xyww;
            }`,
        fragmentShader: /* glsl */ `
            varying vec3 vDir;
            uniform vec3 uTop, uMid, uLow, uSun, uSunCol, uMist, uInk;
            uniform float uStars, uMoon, uGlow, uTime, uAurora;
            ${NOISE}
            float crest(float x, float k) { return 1.0 - abs(2.0 * vnoise(vec2(x, k)) - 1.0); }
            void main() {
                vec3 d = normalize(vDir);
                float y = d.y;
                // Printed gradient: horizon wash, a pale middle, a dark band on top.
                vec3 col = mix(uLow, uMid, smoothstep(-0.03, 0.24, y));
                col = mix(col, uTop, smoothstep(0.2, 0.78, y));

                float ang = acos(clamp(dot(d, uSun), -1.0, 1.0));
                col += uSunCol * uGlow * (exp(-ang * 5.0) * 0.22 + exp(-ang * 16.0) * 0.18);

                // Stars: one per cell, twinkling.
                vec2 sp = vec2(atan(d.z, d.x) * 46.0, y * 70.0);
                vec2 cell = floor(sp);
                float h = hash21(cell);
                vec2 off = vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5;
                float star = smoothstep(0.09, 0.0, length(fract(sp) - 0.5 - off * 0.6)) * step(0.82, h);
                star *= 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
                col += vec3(1.0, 0.96, 0.85) * star * uStars * smoothstep(0.02, 0.3, y);

                // Night only: the river of stars, and curtains of light over the snow country.
                float river = exp(-pow((d.x * 0.55 + y * 0.83 - 0.5) * 3.4, 2.0)) * (0.35 + 0.65 * fbm2(d.xz * 7.0 + 3.0));
                col += vec3(0.5, 0.62, 0.95) * river * 0.3 * uStars;
                float azA = atan(d.x, -d.z);
                float hem = 0.14 + 0.2 * fbm2(vec2(azA * 1.9 + uTime * 0.015, 0.5));
                float curtain = smoothstep(hem, hem + 0.02, y) * exp(-(y - hem) * 6.5);
                float rays = 0.55 + 0.45 * fbm2(vec2(azA * 13.0 + uTime * 0.05, 1.0));
                vec3 aur = mix(vec3(0.25, 1.0, 0.62), vec3(0.62, 0.35, 1.0), smoothstep(0.0, 0.28, y - hem));
                col += aur * curtain * rays * 0.6 * uStars * uAurora;
                // Now and then, a falling star.
                float beat = uTime * 0.11;
                float which = floor(beat);
                float along = fract(beat) / 0.16;
                vec2 from = vec2(hash21(vec2(which, 1.3)) * 1.5 - 0.75, 0.34 + 0.36 * hash21(vec2(which, 7.1)));
                vec2 way = normalize(vec2(hash21(vec2(which, 4.4)) - 0.5, -0.32));
                vec2 rel = vec2(azA, y) - (from + way * along * 0.34);
                float back = dot(rel, way);
                float streak = smoothstep(0.0035, 0.0, length(rel - way * back)) * smoothstep(-0.14, 0.0, back) * step(back, 0.0);
                col += vec3(1.0, 0.96, 0.84) * streak * uStars * step(along, 1.0) * step(0.45, hash21(vec2(which, 3.3)));

                // The sun: a flat disc with a crisp edge. At night, a crescent moon.
                float R = mix(0.094, 0.05, smoothstep(0.24, 0.5, uSun.y));
                float disc = 1.0 - smoothstep(R - 0.0025, R + 0.0025, ang);
                vec3 side = normalize(cross(uSun, vec3(0.0, 1.0, 0.0)));
                float bite = acos(clamp(dot(d, normalize(uSun + side * 0.05 + vec3(0.0, 0.02, 0.0))), -1.0, 1.0));
                disc *= 1.0 - uMoon * (1.0 - smoothstep(R * 0.86 - 0.003, R * 0.86 + 0.003, bite));
                // Printed with a gradient, like the sun of an old print: deeper at its foot.
                col = mix(col, uSunCol * mix(0.86, 1.04, smoothstep(-R, R, y - uSun.y)), disc);

                // Clouds: long flat bands, the way a print draws them.
                float az = atan(d.x, -d.z);
                float c = fbm2(vec2(az * 2.6 + uTime * 0.006, y * 30.0 + 2.0));
                float band = smoothstep(0.015, 0.09, y) * (1.0 - smoothstep(0.26, 0.5, y));
                float cloud = smoothstep(0.55, 0.585, c) * band;
                // Clouds near the sun burn with its colour; their thin edges catch it first.
                float nearSun = exp(-ang * 2.4);
                vec3 body = mix(mix(uMist, vec3(1.0), 0.32), mix(uMid, uTop, 0.3), 0.25 * (1.0 - nearSun));
                vec3 edge = body + uSunCol * uGlow * (0.12 + 0.5 * nearSun);
                vec3 cloudCol = mix(edge, body + uSunCol * uGlow * 0.3 * nearSun, smoothstep(0.585, 0.66, c));
                col = mix(col, cloudCol, cloud * 0.85);

                // Two ranges of far mountains, too distant to ever reach: the scale of the land.
                float glowAt = pow(max(dot(d, uSun), 0.0), 6.0) * uGlow;
                float far = 0.022 + 0.12 * (0.58 * crest(az * 2.6, 1.7) + 0.3 * crest(az * 6.1 + 2.0, 4.2) + 0.12 * crest(az * 15.0, 8.8));
                vec3 farCol = mix(uLow, uInk, 0.13) + uSunCol * glowAt * 0.45;
                farCol = mix(farCol, mix(uLow, vec3(1.0), 0.45), smoothstep(far - 0.035, far - 0.004, y) * 0.5);
                col = mix(col, farCol, smoothstep(far + 0.002, far - 0.002, y));
                float nearR = 0.006 + 0.072 * (0.6 * crest(az * 3.7 + 9.0, 12.3) + 0.28 * crest(az * 9.0 + 1.0, 15.1) + 0.12 * crest(az * 23.0, 19.0));
                vec3 nearCol = mix(uLow, uInk, 0.27) + uSunCol * glowAt * 0.3;
                col = mix(col, nearCol, smoothstep(nearR + 0.002, nearR - 0.002, y));

                // Below the horizon the sky melts into the mist.
                col = mix(col, uLow, smoothstep(0.0, -0.08, y));
                gl_FragColor = vec4(col, 1.0);
            }`,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMat)
    sky.frustumCulled = false
    sky.renderOrder = -10
    scene.add(sky)

    // ---- Terrain -------------------------------------------------------
    const terrainMat = new THREE.ShaderMaterial({
        uniforms: {
            ...shared,
            uLandLow: { value: landUniform("low") },
            uLandMid: { value: landUniform("mid") },
            uLandHigh: { value: landUniform("high") },
            uLandRock: { value: landUniform("rock") },
            uSkyTop: skyTop,
        },
        vertexShader: /* glsl */ `
            attribute vec2 aBiome;
            attribute float aHorizon;
            varying vec3 vPos;
            varying vec3 vNormal;
            varying vec3 vBiome;
            varying float vHorizon;
            void main() {
                vHorizon = aHorizon;
                vPos = position;
                vNormal = normal;
                vBiome = vec3(aBiome, 1.0 - aBiome.x - aBiome.y);
                gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */ `
            varying vec3 vPos;
            varying vec3 vNormal;
            varying vec3 vBiome;
            varying float vHorizon;
            uniform vec3 uLandLow[3], uLandMid[3], uLandHigh[3], uLandRock[3];
            uniform vec3 uLight, uInk, uSkyTop;
            ${NOISE}
            ${AIR}
            vec3 blend(vec3 c[3]) { return c[0] * vBiome.x + c[1] * vBiome.y + c[2] * vBiome.z; }
            void main() {
                vec3 n = normalize(vNormal);
                float h = vPos.y;
                float d = distance(vPos, cameraPosition);
                float slope = 1.0 - n.y;

                // Colour by height, in flat bands with hand-cut, wobbly edges.
                float wob = (fbm2(vPos.xz * 0.018) - 0.5) * 34.0;
                vec3 alb = mix(blend(uLandLow), blend(uLandMid), smoothstep(16.0, 22.0, h + wob));
                alb = mix(alb, blend(uLandHigh), smoothstep(96.0, 106.0, h + wob * 1.7));

                // Steep faces are bare rock, brushed with vertical strokes.
                float rockAmt = smoothstep(0.34, 0.5, slope);
                float stroke = vnoise(vec2((vPos.x + vPos.z) * 0.42, h * 0.03));
                vec3 rock = blend(uLandRock) * mix(0.74, 1.06, smoothstep(0.38, 0.62, stroke));
                alb = mix(alb, rock, rockAmt);

                // A pale line where land meets water.
                float shore = (1.0 - smoothstep(0.4, 2.8, h)) * vBiome.x;
                alb = mix(alb, vec3(0.93, 0.9, 0.8), shore * 0.7);

                // Up close the sand shows the ripples the wind combed into it.
                float close = 1.0 - smoothstep(20.0, 150.0, d);
                float ripple = sin(vPos.x * 1.1 + vPos.z * 0.45 + vnoise(vPos.xz * 0.05) * 7.0);
                alb *= 1.0 + vBiome.y * close * 0.075 * ripple * (1.0 - rockAmt);

                // Light. A face is lit if it turns to the sun and nothing between it
                // and the sun stands taller: each point knows how high its horizon
                // is in the sun's direction, so ridges throw long shadows at dawn
                // and dusk and only the peaks catch the last light.
                float ndl = dot(n, uSun);
                float sunTan = uSun.y / max(length(uSun.xz), 0.001);
                float open = smoothstep(vHorizon - 0.008, vHorizon + 0.026, sunTan);
                // Slow shadows of clouds cross the land.
                float cloudShade = smoothstep(0.5, 0.64, fbm2(vPos.xz * 0.0013 + vec2(uTime * 0.006, uTime * 0.002)));
                float lit = smoothstep(-0.04, 0.2, ndl) * open * (1.0 - 0.5 * cloudShade);
                // A print has a few flat tones, not a gradient: three steps of light.
                float steps = lit * 3.0;
                lit = (floor(steps) + smoothstep(0.4, 0.6, fract(steps))) / 3.0;
                vec3 shade = alb * (uLight * 0.5 + uSkyTop * 0.22);
                vec3 col = mix(mix(shade, uInk, 0.3), alb * uLight, lit);
                // The low sun warms whatever it still reaches.
                col += uSunCol * uGlow * lit * (0.1 + 0.16 * pow(max(ndl, 0.0), 2.0));
                // Edges turned almost away from the eye, towards the sun, catch a rim of light.
                vec3 v = normalize(cameraPosition - vPos);
                float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * pow(max(dot(-v, uSun), 0.0), 3.0);
                col += uSunCol * uGlow * rim * 0.55;
                // Snow glitters where the light strikes single crystals.
                float glint = step(0.993, hash21(floor(vPos.xz * 2.2))) * (0.5 + 0.5 * sin(uTime * 3.0 + vPos.x * 1.7));
                col += vec3(1.0) * glint * close * vBiome.z * lit * 0.7;

                // Contour lines, like the cuts of a printing block.
                float f = h / 11.0;
                float w = fwidth(f);
                float line = 1.0 - smoothstep(w * 0.5, w * 1.5, abs(fract(f) - 0.5));
                line *= (1.0 - smoothstep(160.0, 620.0, d)) * (0.1 - 0.06 * vBiome.y) * smoothstep(14.0, 60.0, d) * (1.0 - rockAmt);
                col = mix(col, uInk, line);

                gl_FragColor = vec4(applyAir(col, vPos), 1.0);
            }`,
    })

    // ---- Trees: dabs of paint, not models ---------------------------------
    // Each tree is two or three round dabs (or one pine shape) drawn as point
    // sprites, lit on the side that faces the sun. Thousands cost almost nothing.
    const treeMat = new THREE.ShaderMaterial({
        uniforms: { ...shared, uPx: { value: 600 }, uSunView: { value: new THREE.Vector2(0, 1) }, uNight: { value: 0 } },
        vertexShader: /* glsl */ `
            attribute float aSize;
            attribute vec3 aColor;
            attribute float aKind;
            attribute float aShadow;
            varying float vShadow;
            uniform float uPx;
            varying vec3 vPos;
            varying vec3 vCol;
            varying float vKind;
            varying float vSeed;
            void main() {
                vPos = position;
                vCol = aColor;
                vKind = aKind;
                vShadow = aShadow;
                vSeed = fract(position.x * 0.37 + position.z * 0.91);
                vec4 mv = viewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSize * uPx / max(-mv.z, 1.0);
            }`,
        fragmentShader: /* glsl */ `
            varying vec3 vPos;
            varying vec3 vCol;
            varying float vKind;
            varying float vSeed;
            varying float vShadow;
            uniform vec3 uLight, uInk;
            uniform vec2 uSunView;
            uniform float uNight;
            ${AIR}
            void main() {
                vec2 p = gl_PointCoord * 2.0 - 1.0;
                p.y = -p.y;
                vec3 tone = vCol;
                float window = 0.0;
                float rim = 0.0;
                // Foliage right at the lens dissolves so it never fills the frame.
                float nearCam = distance(vPos, cameraPosition);
                if (nearCam < 36.0 && airHash(gl_FragCoord.xy) > (nearCam - 13.0) / 23.0) discard;
                if (vKind < 0.5) {
                    // A leafy round with a slightly scalloped edge.
                    // A canopy cut as five overlapping rounds, like a cloud of leaves.
                    // The seed stretches it tall or wide and shifts the lobes.
                    vec2 q = p;
                    float cut = fract(vSeed * 7.0);
                    if (cut < 0.33) q.x *= 1.4;
                    else if (cut < 0.62) q.y = q.y * 1.45 + 0.22;
                    float j = vSeed * 6.28;
                    float sd = length(q - vec2(0.0, -0.14)) - 0.6;
                    sd = min(sd, length(q - vec2(-0.44 + 0.06 * sin(j), 0.0)) - 0.4);
                    sd = min(sd, length(q - vec2(0.44 + 0.06 * cos(j), -0.02)) - 0.4);
                    sd = min(sd, length(q - vec2(0.08 * sin(j * 2.0), 0.4)) - 0.42);
                    sd = min(sd, length(q - vec2(-0.26, 0.3 + 0.06 * cos(j * 3.0))) - 0.36);
                    if (sd > 0.0) discard;
                    rim = smoothstep(-0.1, -0.03, sd);
                } else if (vKind < 1.5) {
                    // A pine: three stacked tiers narrowing to a point.
                    float y = p.y * 0.5 + 0.5;
                    float tier = fract(y * 3.0);
                    float w = (1.0 - y) * 0.6 * (1.0 - tier * 0.38) + 0.03;
                    if (abs(p.x) > w || y < 0.04) discard;
                } else {
                    // A house: pale walls under a dark, steep roof, with two windows.
                    float roof = step(0.02, p.y) * step(p.y, 0.82) * step(abs(p.x), (0.92 - p.y) * 1.0);
                    float wall = step(p.y, 0.02) * step(-0.74, p.y) * step(abs(p.x), 0.6);
                    if (roof + wall < 0.5) discard;
                    if (roof > 0.5) tone = mix(vec3(0.34, 0.2, 0.2), uInk, 0.3);
                    window = wall * step(abs(abs(p.x) - 0.29), 0.12) * step(abs(p.y + 0.34), 0.17);
                }
                float sunTan = uSun.y / max(length(uSun.xz), 0.001);
                float open = smoothstep(vShadow - 0.03, vShadow + 0.07, sunTan);
                float cloudShade = smoothstep(0.5, 0.64, 0.5 * airNoise(vPos.xz * 0.0013 + vec2(uTime * 0.006, uTime * 0.002)) + 0.3 * airNoise(vPos.xz * 0.00273 + 7.3 + vec2(uTime * 0.0126, uTime * 0.0042)) + 0.2 * airNoise(vPos.xz * 0.00559 - 3.1 + vec2(uTime * 0.0258, uTime * 0.0086)));
                // Two flat tones with a hard edge between them, and a darker foot.
                float lit = smoothstep(-0.03, 0.03, dot(p, uSunView) + 0.14) * open * (1.0 - 0.5 * cloudShade);
                vec3 col = tone * uLight * mix(0.72, 1.06, lit);
                if (vKind < 1.5) col *= 1.0 - 0.24 * smoothstep(-0.2, -0.36, p.y);
                // An ink edge round every canopy.
                col = mix(col, uInk, rim * 0.5);
                col = mix(col, uInk, (1.0 - lit) * 0.32);
                col += uSunCol * uGlow * lit * 0.12;
                // After dark the windows are lit from inside.
                col = mix(col, vec3(1.0, 0.76, 0.36), window * uNight);
                gl_FragColor = vec4(applyAir(col, vPos), 1.0);
            }`,
    })
    const TREES = 580

    // ---- Chunks --------------------------------------------------------
    let world = makeWorld(seed)
    const chunks = new Map()
    const pool = []
    let queue = []
    let indexCache = null
    const dummy = new THREE.Object3D()

    function indices() {
        if (indexCache) return indexCache
        const idx = new Uint16Array(RES * RES * 6)
        let p = 0
        for (let j = 0; j < RES; j++) {
            for (let i = 0; i < RES; i++) {
                const a = j * (RES + 1) + i
                idx[p++] = a
                idx[p++] = a + RES + 1
                idx[p++] = a + 1
                idx[p++] = a + 1
                idx[p++] = a + RES + 1
                idx[p++] = a + RES + 2
            }
        }
        indexCache = new THREE.BufferAttribute(idx, 1)
        return indexCache
    }

    function makeChunk() {
        const count = (RES + 1) * (RES + 1)
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
        geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
        geo.setAttribute("aBiome", new THREE.BufferAttribute(new Float32Array(count * 2), 2))
        geo.setAttribute("aHorizon", new THREE.BufferAttribute(new Float32Array(count), 1))
        geo.setIndex(indices())
        geo.boundingSphere = new THREE.Sphere()
        const mesh = new THREE.Mesh(geo, terrainMat)
        const tg = new THREE.BufferGeometry()
        tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TREES * 3), 3))
        tg.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(TREES), 1))
        tg.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(TREES * 3), 3))
        tg.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(TREES), 1))
        tg.setAttribute("aShadow", new THREE.BufferAttribute(new Float32Array(TREES), 1))
        const trees = new THREE.Points(tg, treeMat)
        trees.frustumCulled = false
        mesh.add(trees)
        scene.add(mesh)
        return { mesh, trees }
    }

    // The sun always stands in the same compass direction; only its height
    // changes. So how much sky a point can see that way is fixed, and can be
    // measured once: the steepest rise towards the sun.
    const SUN_X = 0.305
    const SUN_Z = -0.952
    const REACH = [14, 34, 70, 130, 220, 340]
    function horizonAt(x, z, h) {
        let steepest = 0
        for (const d of REACH) {
            const t = (world.heightAt(x + SUN_X * d, z + SUN_Z * d) - h) / d
            if (t > steepest) steepest = t
        }
        return steepest
    }

    const heights = new Float32Array((40 + 3) * (40 + 3))
    const bw = [0, 0, 0]
    function fillChunk(chunk, cx, cz) {
        const { mesh, trees } = chunk
        const step = CHUNK / RES
        const x0 = cx * CHUNK
        const z0 = cz * CHUNK
        const W = RES + 3
        let top = -1e9
        for (let j = -1; j <= RES + 1; j++) {
            for (let i = -1; i <= RES + 1; i++) {
                const h = world.heightAt(x0 + i * step, z0 + j * step)
                heights[(j + 1) * W + i + 1] = h
                if (h > top) top = h
            }
        }
        const pos = mesh.geometry.attributes.position.array
        const nor = mesh.geometry.attributes.normal.array
        const bio = mesh.geometry.attributes.aBiome.array
        let p = 0
        let b = 0
        for (let j = 0; j <= RES; j++) {
            world.biomeAt(z0 + j * step, bw)
            for (let i = 0; i <= RES; i++) {
                const c = (j + 1) * W + i + 1
                pos[p] = x0 + i * step
                pos[p + 1] = heights[c]
                pos[p + 2] = z0 + j * step
                const nx = heights[c - 1] - heights[c + 1]
                const nz = heights[c - W] - heights[c + W]
                const len = Math.hypot(nx, 2 * step, nz)
                nor[p] = nx / len
                nor[p + 1] = (2 * step) / len
                nor[p + 2] = nz / len
                bio[b++] = bw[0]
                bio[b++] = bw[1]
                p += 3
            }
        }
        // Horizon towards the sun, on every other vertex, then filled in between.
        const hor = mesh.geometry.attributes.aHorizon.array
        const V = RES + 1
        for (let j = 0; j <= RES; j += 2) {
            for (let i = 0; i <= RES; i += 2) hor[j * V + i] = horizonAt(x0 + i * step, z0 + j * step, heights[(j + 1) * W + i + 1])
        }
        for (let j = 0; j <= RES; j += 2) for (let i = 1; i < RES; i += 2) hor[j * V + i] = (hor[j * V + i - 1] + hor[j * V + i + 1]) / 2
        for (let j = 1; j < RES; j += 2) for (let i = 0; i <= RES; i++) hor[j * V + i] = (hor[(j - 1) * V + i] + hor[(j + 1) * V + i]) / 2
        mesh.geometry.attributes.position.needsUpdate = true
        mesh.geometry.attributes.normal.needsUpdate = true
        mesh.geometry.attributes.aBiome.needsUpdate = true
        mesh.geometry.attributes.aHorizon.needsUpdate = true
        mesh.geometry.boundingSphere.center.set(x0 + CHUNK / 2, top / 2, z0 + CHUNK / 2)
        mesh.geometry.boundingSphere.radius = Math.hypot(CHUNK * 0.71, top / 2 + 20)

        // Trees: scattered where the ground is gentle, by a per-chunk seed.
        world.biomeAt(z0 + CHUNK / 2, bw)
        const kind = bw[2] > 0.5 ? "snow" : bw[1] > 0.5 ? "dunes" : "karst"
        let s = ((cx * 73856093) ^ (cz * 19349663) ^ world.seed) >>> 0
        const rnd = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            return s / 4294967296
        }
        const tp = trees.geometry.attributes.position.array
        const ts = trees.geometry.attributes.aSize.array
        const tc = trees.geometry.attributes.aColor.array
        const tk = trees.geometry.attributes.aKind.array
        const th = trees.geometry.attributes.aShadow.array
        let shadow = 0
        const base = LAND[kind].tree
        let n = 0
        const dab = (x, y, z, size, r, g, b, pine) => {
            if (n >= TREES) return
            tp[n * 3] = x
            tp[n * 3 + 1] = y
            tp[n * 3 + 2] = z
            ts[n] = size
            tc[n * 3] = r
            tc[n * 3 + 1] = g
            tc[n * 3 + 2] = b
            tk[n] = pine === true ? 1 : pine || 0
            th[n] = shadow
            n++
        }
        const tries = kind === "dunes" ? 50 : 760
        for (let t = 0; t < tries && n < TREES - 3; t++) {
            const x = x0 + rnd() * CHUNK
            const z = z0 + rnd() * CHUNK
            const r1 = rnd()
            const r2 = rnd()
            // Trees gather in groves and leave open ground between them.
            if (world.noise(x * 0.012 + 50, z * 0.012) < (kind === "dunes" ? 0.72 : 0.5)) continue
            const h = world.heightAt(x, z)
            if (h < 4 || h > (kind === "snow" ? 150 : 118)) continue
            if (Math.abs(world.heightAt(x + 4, z) - h) > 3.4 || Math.abs(world.heightAt(x, z + 4) - h) > 3.4) continue
            const tone = 0.8 + r2 * 0.42
            shadow = horizonAt(x, z, h + 4)
            if (kind === "snow") {
                const size = 11 + r1 * 10
                dab(x, h + size * 0.46, z, size, base[0] * tone, base[1] * tone, base[2] * tone, true)
            } else if (kind === "dunes") {
                dab(x, h + 1.2, z, 3 + r1 * 2.5, base[0] * tone, base[1] * tone, base[2] * tone, false)
            } else {
                // A canopy of three overlapping dabs; one tree in seven is in bloom.
                const size = 4 + r1 * r1 * 14
                const bloom = r2 > 0.86
                const cr = bloom ? 0.97 : base[0] * tone
                const cg = bloom ? 0.68 : base[1] * tone
                const cb = bloom ? 0.74 : base[2] * tone
                dab(x, h + size * 0.42, z, size, cr, cg, cb, false)
                dab(x + size * 0.34, h + size * 0.3, z + size * 0.2, size * 0.74, cr * 0.9, cg * 0.92, cb * 0.9, false)
                dab(x - size * 0.3, h + size * 0.34, z - size * 0.24, size * 0.66, cr * 1.08, cg * 1.06, cb * 1.02, false)
            }
        }
        // Meadow flowers in the river country: small bright dabs in loose drifts.
        if (kind === "karst") {
            const FLOWERS = [
                [1.0, 0.98, 0.9],
                [1.0, 0.84, 0.3],
                [0.98, 0.6, 0.76],
                [0.72, 0.62, 0.97],
            ]
            for (let c = 0; c < 34 && n < TREES - 8; c++) {
                const fx = x0 + rnd() * CHUNK
                const fz = z0 + rnd() * CHUNK
                const fh = world.heightAt(fx, fz)
                if (fh < 2.5 || fh > 30) continue
                shadow = horizonAt(fx, fz, fh + 1)
                const hue = FLOWERS[Math.floor(rnd() * FLOWERS.length)]
                for (let k = 0; k < 6; k++) {
                    const x = fx + (rnd() - 0.5) * 16
                    const z = fz + (rnd() - 0.5) * 16
                    const h = world.heightAt(x, z)
                    if (h < 2.2) continue
                    dab(x, h + 0.7, z, 1.1 + rnd() * 0.9, hue[0], hue[1], hue[2], false)
                }
            }
        }

        // Villages: a handful of houses on gentle ground, every so often along the valley.
        if (kind !== "dunes") {
            const first = Math.floor((-(z0 + CHUNK) - 1200) / 1100) - 1
            for (let v = Math.max(0, first); v <= first + 3; v++) {
                const vz = -(1200 + v * 1100 + world.noise(v * 13.7, 3.3) * 300)
                const vx = world.pathX(vz) + (world.noise(v * 7.9, 9.1) - 0.5) * 150
                if (vx < x0 || vx >= x0 + CHUNK || vz < z0 || vz >= z0 + CHUNK) continue
                for (let k = 0; k < 9 && n < TREES - 1; k++) {
                    const x = vx + (rnd() - 0.5) * 60
                    const z = vz + (rnd() - 0.5) * 60
                    const h = world.heightAt(x, z)
                    if (h < 3 || h > 60 || Math.abs(world.heightAt(x + 5, z) - h) > 2.6 || Math.abs(world.heightAt(x, z + 5) - h) > 2.6) continue
                    const size = 7.5 + rnd() * 3
                    const wall = 0.84 + rnd() * 0.14
                    shadow = horizonAt(x, z, h + 4)
                    dab(x, h + size * 0.36, z, size, wall, wall * 0.95, wall * 0.84, 2)
                }
            }
        }

        trees.geometry.setDrawRange(0, n)
        trees.geometry.attributes.position.needsUpdate = true
        trees.geometry.attributes.aSize.needsUpdate = true
        trees.geometry.attributes.aColor.needsUpdate = true
        trees.geometry.attributes.aKind.needsUpdate = true
        trees.geometry.attributes.aShadow.needsUpdate = true
        mesh.visible = true
    }

    function updateChunks(px, pz, budget) {
        const ccx = Math.floor(px / CHUNK)
        const ccz = Math.floor(pz / CHUNK)
        const wanted = new Set()
        for (let dz = -AHEAD; dz <= BEHIND; dz++) for (let dx = -SIDE; dx <= SIDE; dx++) wanted.add(`${ccx + dx},${ccz + dz}`)
        for (const [key, chunk] of chunks) {
            if (!wanted.has(key)) {
                chunk.mesh.visible = false
                pool.push(chunk)
                chunks.delete(key)
            }
        }
        queue = []
        for (const key of wanted) {
            if (chunks.has(key)) continue
            const [cx, cz] = key.split(",").map(Number)
            queue.push({ key, cx, cz, d: Math.abs(cx - ccx) + Math.abs(cz - ccz) * 0.6 })
        }
        queue.sort((a, b) => a.d - b.d)
        for (let i = 0; i < queue.length && i < budget; i++) {
            const q = queue[i]
            const chunk = pool.pop() || makeChunk()
            fillChunk(chunk, q.cx, q.cz)
            chunks.set(q.key, chunk)
        }
    }

    // ---- Water ---------------------------------------------------------
    const waterMat = new THREE.ShaderMaterial({
        uniforms: { ...shared, uWater: { value: new THREE.Vector3() }, uIce: { value: 0 }, uSkyMid: skyMid },
        vertexShader: /* glsl */ `
            varying vec3 vPos;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vPos = wp.xyz;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: /* glsl */ `
            varying vec3 vPos;
            uniform vec3 uWater, uLight, uSkyMid;
            uniform float uIce;
            ${NOISE}
            ${AIR}
            void main() {
                vec3 v = normalize(cameraPosition - vPos);
                float d = distance(cameraPosition, vPos);
                float fres = pow(1.0 - max(v.y, 0.0), 3.0);
                // The water mirrors the sky above the far bank.
                vec3 refl = reflect(-v, vec3(0.0, 1.0, 0.0));
                vec3 mirror = mix(uHaze, uSkyMid, smoothstep(0.0, 0.45, refl.y));
                vec3 col = mix(uWater, mirror, 0.22 + 0.68 * fres);

                // Ripples drawn as short pale strokes.
                float r = vnoise(vec2(vPos.x * 0.028, vPos.z * 0.16 + uTime * 0.22));
                float rip = smoothstep(0.66, 0.69, r) * (1.0 - smoothstep(60.0, 520.0, d));
                col = mix(col, uHaze, rip * 0.35);

                // The sun's road: a broken stripe of light on the water.
                float s = max(dot(refl, uSun), 0.0);
                col += uSunCol * uGlow * pow(s, 5.0) * 0.2;
                float road = pow(s, 120.0) * 1.4 + pow(s, 18.0) * 0.22;
                float dash = smoothstep(0.42, 0.5, vnoise(vec2(vPos.x * 0.07, vPos.z * 0.42 + uTime * 0.5)));
                col = mix(col, mix(uSunCol, uHaze, 0.42), clamp(road * (0.3 + 0.7 * dash), 0.0, 1.0) * (0.5 + 0.4 * uGlow));

                // In the snow country the lake is frozen.
                vec3 ice = vec3(0.86, 0.92, 0.96) * uLight * mix(0.92, 1.0, vnoise(vPos.xz * 0.05));
                col = mix(col, ice, uIce * 0.85);
                gl_FragColor = vec4(applyAir(col, vPos), 1.0);
            }`,
    })
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), waterMat)
    water.position.y = WATER
    water.frustumCulled = false
    scene.add(water)

    // ---- The glider: a folded paper plane -------------------------------
    const gliderGeo = new THREE.BufferGeometry()
    {
        const nose = [0, 0, -2.1]
        const left = [-1.55, 0.22, 1.15]
        const right = [1.55, 0.22, 1.15]
        const crease = [0, 0.05, 1.15]
        const keel = [0, -0.5, 0.95]
        const faces = [
            [nose, crease, left, 0],
            [nose, right, crease, 0],
            [nose, left, crease, 1],
            [nose, crease, right, 1],
            [nose, keel, crease, 2],
            [nose, crease, keel, 2],
        ]
        const pos = []
        const shade = []
        faces.forEach(([a, b, c, k]) => {
            pos.push(...a, ...b, ...c)
            shade.push(k, k, k)
        })
        gliderGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
        gliderGeo.setAttribute("aPart", new THREE.Float32BufferAttribute(shade, 1))
        gliderGeo.computeVertexNormals()
    }
    const gliderMat = new THREE.ShaderMaterial({
        side: THREE.FrontSide,
        uniforms: { ...shared },
        vertexShader: /* glsl */ `
            attribute float aPart;
            varying float vPart;
            varying vec3 vN;
            varying vec3 vLocal;
            void main() {
                vLocal = position;
                vPart = aPart;
                vN = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */ `
            varying float vPart;
            varying vec3 vN;
            varying vec3 vLocal;
            uniform vec3 uSun, uLight, uSunCol;
            uniform float uGlow;
            void main() {
                vec3 red = vec3(0.89, 0.2, 0.14);
                vec3 col = vPart < 0.5 ? vec3(0.98, 0.94, 0.86) : vPart < 1.5 ? red : red * 0.7;
                // Paper: a dark centre crease, a lighter second fold on each wing,
                // and a pale edge along the back where the sheet ends.
                float ax = abs(vLocal.x);
                col *= 1.0 - 0.3 * smoothstep(0.09, 0.02, ax);
                col *= 1.0 + 0.14 * smoothstep(0.05, 0.0, abs(ax - 0.62 * (vLocal.z + 2.1) / 3.25));
                col = mix(col, vec3(1.0, 0.95, 0.88), 0.35 * smoothstep(1.02, 1.14, vLocal.z) * step(vPart, 1.5));
                float ndl = dot(normalize(vN), uSun);
                col += uSunCol * uGlow * pow(max(ndl, 0.0), 6.0) * 0.3;
                float lit = smoothstep(-0.2, 0.5, ndl);
                // Never fully in the dark: the plane is the one thing you must always see.
                col *= mix(vec3(1.0), uLight, 0.45) * mix(0.72, 1.0, lit);
                gl_FragColor = vec4(col, 1.0);
            }`,
    })
    const glider = new THREE.Mesh(gliderGeo, gliderMat)
    glider.frustumCulled = false
    scene.add(glider)

    // ---- Gates: red frames in the valley, the one thing here made by hands --
    const GATES = 3
    const gateMat = new THREE.ShaderMaterial({
        uniforms: { ...shared },
        vertexShader: /* glsl */ `
            varying vec3 vPos;
            varying vec3 vN;
            varying vec3 vCol;
            void main() {
                vec4 wp = instanceMatrix * vec4(position, 1.0);
                vPos = wp.xyz;
                vN = normalize(mat3(instanceMatrix) * normal);
                vCol = instanceColor;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: /* glsl */ `
            varying vec3 vPos;
            varying vec3 vN;
            varying vec3 vCol;
            uniform vec3 uLight, uInk;
            ${AIR}
            void main() {
                // The gate dissolves as you pass through it.
                float nearCam = distance(vPos, cameraPosition);
                if (nearCam < 75.0 && airHash(gl_FragCoord.xy) > (nearCam - 22.0) / 53.0) discard;
                float lit = smoothstep(-0.1, 0.3, dot(normalize(vN), uSun));
                vec3 col = vCol * mix(vec3(1.0), uLight, 0.72) * mix(0.6, 1.0, lit);
                col = mix(col, uInk, (1.0 - lit) * 0.22);
                col += uSunCol * uGlow * lit * 0.14;
                gl_FragColor = vec4(applyAir(col, vPos), 1.0);
            }`,
    })
    // Two posts, a red tie beam, and a dark lintel that sweeps wider than the posts.
    const GATE_PARTS = [
        [-22, 23, 3.4, 46, 3.4, 0xd8392b],
        [22, 23, 3.4, 46, 3.4, 0xd8392b],
        [0, 38.6, 54, 2.6, 2.8, 0xd8392b],
        [0, 47.4, 68, 3.6, 5, 0x24202b],
        [0, 50.4, 72, 1.6, 6, 0x24202b],
    ]
    const gateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), gateMat, GATES * GATE_PARTS.length)
    gateMesh.frustumCulled = false
    scene.add(gateMesh)
    const gateTint = new THREE.Color()
    let gatesFrom = -1
    function updateGates() {
        const first = Math.max(0, flight.nextGate - 1)
        if (first === gatesFrom) return
        gatesFrom = first
        let n = 0
        for (let g = first; g < first + GATES; g++) {
            const gt = world.gate(g)
            const cy = Math.cos(gt.yaw)
            const sy = Math.sin(gt.yaw)
            for (const [lx, ly, w, h, depth, colour] of GATE_PARTS) {
                dummy.position.set(gt.x + cy * lx, gt.y - 3 + ly, gt.z + sy * lx)
                dummy.rotation.set(0, -gt.yaw, 0)
                dummy.scale.set(w, h, depth)
                dummy.updateMatrix()
                gateMesh.setMatrixAt(n, dummy.matrix)
                gateMesh.setColorAt(n, gateTint.setHex(colour))
                n++
            }
        }
        gateMesh.instanceMatrix.needsUpdate = true
        gateMesh.instanceColor.needsUpdate = true
    }

    // The plane's shadow on the ground: it tells you how high you are.
    const shadowDisc = new THREE.Mesh(
        new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x0a0c1a, transparent: true, opacity: 0.3, depthWrite: false })
    )
    shadowDisc.frustumCulled = false
    scene.add(shadowDisc)

    // Wind streaks that rush past the lens in a fast dive.
    const STREAKS = 44
    const streakSeed = Array.from({ length: STREAKS }, () => {
        const a = Math.random() * 6.28
        const r = 7 + Math.random() * 26
        return [Math.cos(a) * r, Math.sin(a) * r * 0.6, Math.random() * 90]
    })
    const streakGeo = new THREE.BufferGeometry()
    streakGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3))
    const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0xfff6e4, transparent: true, opacity: 0, depthWrite: false }))
    streaks.frustumCulled = false
    camera.add(streaks)
    scene.add(camera)
    let streakTravel = 0

    // ---- Ribbon trails from the wing tips -------------------------------
    const TRAIL = 70
    function makeTrail() {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3))
        const alpha = new Float32Array(TRAIL * 2)
        for (let i = 0; i < TRAIL; i++) alpha[i * 2] = alpha[i * 2 + 1] = Math.pow(1 - i / (TRAIL - 1), 1.5)
        geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1))
        const idx = []
        for (let i = 0; i < TRAIL - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
        geo.setIndex(idx)
        const mesh = new THREE.Mesh(
            geo,
            new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                uniforms: { uOpacity: { value: 0.75 } },
                vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`,
                fragmentShader: `varying float vA; uniform float uOpacity; void main(){ gl_FragColor = vec4(1.0, 0.98, 0.93, vA * uOpacity); }`,
            })
        )
        mesh.frustumCulled = false
        scene.add(mesh)
        return { mesh, points: [], ups: [] }
    }
    const trails = [makeTrail(), makeTrail()]
    const tipLocal = [new THREE.Vector3(-1.5, 0.22, 1.1), new THREE.Vector3(1.5, 0.22, 1.1)]
    const tmp = new THREE.Vector3()
    const tmp2 = new THREE.Vector3()

    function updateTrail(trail, tip) {
        tmp.copy(tip).applyMatrix4(glider.matrixWorld)
        const last = trail.points[0]
        if (!last || last.distanceToSquared(tmp) > 1.4) {
            trail.points.unshift(tmp.clone())
            if (trail.points.length > TRAIL) trail.points.pop()
        } else {
            last.copy(tmp)
        }
        const pos = trail.mesh.geometry.attributes.position.array
        tmp2.set(0, 1, 0).applyQuaternion(glider.quaternion)
        for (let i = 0; i < TRAIL; i++) {
            const p = trail.points[Math.min(i, trail.points.length - 1)]
            const w = 0.05 * (1 - (i / TRAIL) * 0.8)
            pos[i * 6] = p.x + tmp2.x * w
            pos[i * 6 + 1] = p.y + tmp2.y * w
            pos[i * 6 + 2] = p.z + tmp2.z * w
            pos[i * 6 + 3] = p.x - tmp2.x * w
            pos[i * 6 + 4] = p.y - tmp2.y * w
            pos[i * 6 + 5] = p.z - tmp2.z * w
        }
        trail.mesh.geometry.attributes.position.needsUpdate = true
    }

    // ---- Points: lantern halos, thermals and drifting motes -------------
    const pointsMaterial = (additive) =>
        new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            uniforms: { uScale: { value: 1 } },
            vertexShader: /* glsl */ `
                attribute float aSize;
                attribute vec4 aColor;
                varying vec4 vColor;
                uniform float uScale;
                void main() {
                    vColor = aColor;
                    vec4 mv = viewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = min(aSize * uScale / max(-mv.z, 1.0), 220.0);
                }`,
            fragmentShader: /* glsl */ `
                varying vec4 vColor;
                void main() {
                    float r = length(gl_PointCoord - 0.5) * 2.0;
                    float a = ${additive ? "pow(max(1.0 - r, 0.0), 2.2)" : "1.0 - smoothstep(0.7, 1.0, r)"};
                    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
                }`,
        })
    function makePoints(count, additive) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
        geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1))
        geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 4), 4))
        const pts = new THREE.Points(geo, pointsMaterial(additive))
        pts.frustumCulled = false
        scene.add(pts)
        return pts
    }

    // Lanterns: a paper body plus a soft halo.
    const LANTERNS = 48
    const lanternMat = new THREE.ShaderMaterial({
        uniforms: { ...shared },
        vertexShader: /* glsl */ `
            varying float vY;
            varying vec3 vPos;
            void main() {
                vY = position.y;
                vec4 wp = instanceMatrix * vec4(position, 1.0);
                vPos = wp.xyz;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: /* glsl */ `
            varying float vY;
            varying vec3 vPos;
            ${AIR}
            void main() {
                // Paper lit from inside: hot at the middle, red caps top and bottom.
                vec3 col = mix(vec3(1.0, 0.56, 0.2), vec3(1.0, 0.94, 0.72), 1.0 - abs(vY) * 0.9);
                // Bamboo ribs, dark caps, and a red tassel below.
                col *= 1.0 - 0.2 * smoothstep(0.78, 1.0, abs(sin(vY * 13.0)));
                col = mix(col, vec3(0.2, 0.12, 0.15), step(0.88, abs(vY)));
                col = mix(col, vec3(0.82, 0.18, 0.13), step(vY, -1.02));
                gl_FragColor = vec4(mix(col, applyAir(col, vPos), 0.5), 1.0);
            }`,
    })
    const lanternMesh = new THREE.InstancedMesh(new THREE.LatheGeometry(
            [
                [0.001, -1.7],
                [0.07, -1.7],
                [0.07, -1.02],
                [0.3, -0.97],
                [0.6, -0.62],
                [0.78, 0],
                [0.6, 0.62],
                [0.3, 0.97],
                [0.16, 1.08],
                [0.001, 1.08],
            ].map(([x, y]) => new THREE.Vector2(x, y)),
            12
        ), lanternMat, LANTERNS)
    lanternMesh.frustumCulled = false
    scene.add(lanternMesh)
    const halos = makePoints(LANTERNS, true)
    const lanternCache = new Map()
    const getLantern = (k) => {
        let l = lanternCache.get(k)
        if (!l) {
            l = world.lantern(k)
            lanternCache.set(k, l)
            if (lanternCache.size > 400) lanternCache.delete(lanternCache.keys().next().value)
        }
        return l
    }
    const pops = new Map() // k -> seconds since collected

    const THERMALS = 3
    const PER = 110
    const thermalPts = makePoints(THERMALS * PER, false)
    const MOTES = quality === "low" ? 160 : 360
    const motes = makePoints(MOTES, false)
    const moteSeed = Array.from({ length: MOTES }, (_, i) => [Math.random() * 180, Math.random() * 90, Math.random() * 260, 0.4 + Math.random() * 0.9, i])
    const sparks = makePoints(64, true)
    const sparkList = []

    // Rings: the wake of a skim and the splash of a landing.
    const RINGS = 18
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2)
    const rings = Array.from({ length: RINGS }, () => {
        const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }))
        m.visible = false
        scene.add(m)
        return { m, age: 0, life: 1, grow: 1 }
    })
    let ringAt = 0
    function ring(x, y, z, grow, life, colour) {
        const r = rings[ringAt++ % RINGS]
        r.m.position.set(x, y + 0.15, z)
        r.m.scale.setScalar(0.6)
        r.m.material.color.setRGB(colour[0], colour[1], colour[2])
        r.m.visible = true
        r.age = 0
        r.life = life
        r.grow = grow
    }

    // ---- The finishing pass ------------------------------------------------
    // The picture is drawn to a texture, then printed to the screen with
    // shafts of light fanning out from the sun wherever the land leaves gaps,
    // a touch more contrast, and a dither so the long gradients never band.
    const target = new THREE.WebGLRenderTarget(4, 4, { samples: quality === "low" ? 0 : 4, depthTexture: new THREE.DepthTexture(4, 4) })
    const postMat = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        defines: { STEPS: quality === "low" ? 14 : 30 },
        uniforms: {
            tScene: { value: target.texture },
            tDepth: { value: target.depthTexture },
            uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
            uShafts: { value: 0 },
            uAspect: { value: 1 },
            uSunCol: shared.uSunCol,
            uInk: shared.uInk,
            uTexel: { value: new THREE.Vector2(0.001, 0.001) },
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
            varying vec2 vUv;
            uniform sampler2D tScene, tDepth;
            uniform vec2 uSunUV;
            uniform float uShafts, uAspect;
            uniform vec3 uSunCol, uInk;
            uniform vec2 uTexel;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float metres(vec2 uv) {
                float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
                return 6000.0 / (6000.5 - z * 5999.5);
            }
            void main() {
                vec3 col = texture2D(tScene, vUv).rgb;
                float grain = hash(gl_FragCoord.xy);
                // The key block: an ink line wherever one form stands in front of another.
                float dc = metres(vUv);
                float jump = max(
                    max(abs(metres(vUv - vec2(uTexel.x, 0.0)) - dc), abs(metres(vUv + vec2(uTexel.x, 0.0)) - dc)),
                    max(abs(metres(vUv - vec2(0.0, uTexel.y)) - dc), abs(metres(vUv + vec2(0.0, uTexel.y)) - dc))
                ) / dc;
                float key = smoothstep(0.045, 0.14, jump) * (1.0 - smoothstep(350.0, 1300.0, dc));
                col = mix(col, uInk, key * 0.62);
                if (uShafts > 0.002) {
                    // Walk from this pixel towards the sun, gathering open sky near it.
                    vec2 stride = (vUv - uSunUV) * (0.92 / float(STEPS));
                    vec2 at = vUv - stride * grain;
                    float power = 1.0;
                    float light = 0.0;
                    for (int i = 0; i < STEPS; i++) {
                        at -= stride;
                        vec2 q = (at - uSunUV) * vec2(uAspect, 1.0);
                        float sky = step(0.99995, texture2D(tDepth, at).x);
                        light += sky * exp(-dot(q, q) * 7.0) * power;
                        power *= 0.95;
                    }
                    // Shafts belong on the land and the mist; the open sky is already bright.
                    float here = step(0.99995, texture2D(tDepth, vUv).x);
                    col += uSunCol * (light / float(STEPS)) * uShafts * mix(1.25, 0.3, here) * (1.0 - col * 0.7);
                }
                col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.1);
                col = mix(col, col * col * (3.0 - 2.0 * col), 0.24);
                col += (grain - 0.5) / 170.0;
                gl_FragColor = vec4(col, 1.0);
            }`,
    })
    const postScene = new THREE.Scene()
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat)
    postQuad.frustumCulled = false
    postScene.add(postQuad)
    const sunPoint = new THREE.Vector3()
    const camDir = new THREE.Vector3()

    function draw() {
        // Where the sun is on screen, and how squarely we face it.
        sunPoint.copy(camera.position).addScaledVector(shared.uSun.value, 1000).project(camera)
        camera.getWorldDirection(camDir)
        const facing = Math.max(0, camDir.dot(shared.uSun.value))
        const off = Math.max(Math.abs(sunPoint.x), Math.abs(sunPoint.y))
        postMat.uniforms.uSunUV.value.set(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5)
        postMat.uniforms.uShafts.value = shared.uGlow.value * Math.min(1, facing * 2) * Math.max(0, 1 - Math.max(0, off - 1) * 1.6)
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        renderer.setRenderTarget(null)
        renderer.render(postScene, postCam)
    }

    // ---- State ---------------------------------------------------------
    let flight = newFlight(world)
    let startDistance = 0
    const travelled = () => Math.max(0, flight.distance - startDistance)
    let mode = "attract"
    const input = { dive: false, steer: 0 }
    let tod = 0.03 + ((seed % 5) / 5) * 0.34 // start somewhere between dawn and late afternoon
    let clock = 0
    let overFor = 0
    let wakeTimer = 0
    let frozen = false
    let raf = 0
    let last = 0
    let frameTick = 0
    const skyNow = {}
    const camPos = new THREE.Vector3()
    const look = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    const euler = new THREE.Euler(0, 0, 0, "YXZ")
    let camReady = false

    function applySky() {
        skyAt(tod, skyNow)
        const set = (u, c) => u.value.set(c[0], c[1], c[2])
        set(shared.uMist, skyNow.mist)
        set(shared.uHaze, skyNow.low)
        set(shared.uSunCol, skyNow.sun)
        set(shared.uLight, skyNow.light)
        set(shared.uInk, skyNow.ink)
        shared.uGlow.value = skyNow.glow
        set(skyTop, skyNow.top)
        set(skyMid, skyNow.mid)
        set(skyMat.uniforms.uLow, skyNow.low)
        skyMat.uniforms.uStars.value = skyNow.stars
        treeMat.uniforms.uNight.value = Math.min(1, skyNow.stars * 1.7 + Math.max(0, 0.14 - skyNow.elev) * 5)
        skyMat.uniforms.uMoon.value = skyNow.moon
        set(waterMat.uniforms.uWater, skyNow.water)
        // The valley runs towards -z, so the sun sits ahead, a little to one side.
        const e = 0.06 + skyNow.elev * 0.62
        shared.uSun.value.set(0.32 * Math.cos(e), Math.sin(e), -Math.cos(e)).normalize()
    }

    function placeGlider() {
        glider.position.set(flight.x, flight.y, flight.z)
        euler.set(flight.pitch, -flight.yaw, flight.roll)
        glider.quaternion.setFromEuler(euler)
        glider.scale.setScalar(1.5)
        glider.updateMatrixWorld()
    }

    function updateCamera(dt) {
        fwd.set(Math.sin(flight.yaw) * Math.cos(flight.pitch), Math.sin(flight.pitch), -Math.cos(flight.yaw) * Math.cos(flight.pitch))
        const fast = Math.min(Math.max((flight.speed - 30) / 60, 0), 1)
        let back = 11 + fast * 4
        let up = 3.4
        let sideways = 0
        if (mode === "attract") {
            // A slow drift around the plane while it waits.
            sideways = Math.sin(clock * 0.16) * 7
            back = 15
            up = 4.4 + Math.sin(clock * 0.11) * 1.6
        } else if (mode === "over") {
            back = 24 + Math.min(overFor, 4) * 6
            up = 16 + Math.min(overFor, 4) * 7
        }
        const cy = Math.cos(flight.yaw)
        const sy = Math.sin(flight.yaw)
        tmp.set(flight.x - sy * back + cy * sideways, flight.y + up - Math.sin(flight.pitch) * 3.4, flight.z + cy * back + sy * sideways)
        const floor = Math.max(world.heightAt(tmp.x, tmp.z), WATER) + 2.2
        if (tmp.y < floor) tmp.y = floor
        if (!camReady) {
            camPos.copy(tmp)
            camReady = true
        } else {
            camPos.lerp(tmp, 1 - Math.exp(-dt * (mode === "over" ? 2.4 : 5.5)))
        }
        camera.position.copy(camPos)
        look.set(flight.x + fwd.x * 22, flight.y + fwd.y * 12 + 1.6, flight.z + fwd.z * 22)
        if (mode === "over") look.y += Math.min(overFor, 4) * 6.5
        camera.up.set(mode === "over" ? 0 : Math.sin(flight.roll * 0.32), 1, 0)
        camera.lookAt(look)
        // A tall screen sees a narrow slice, so open the lens up.
        const fov = 62 + fast * 20 + Math.max(0, 1 - camera.aspect) * 26
        if (Math.abs(camera.fov - fov) > 0.05) {
            camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3))
            camera.updateProjectionMatrix()
        }
        treeMat.uniforms.uPx.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360))
        tmp.copy(shared.uSun.value).transformDirection(camera.matrixWorldInverse)
        treeMat.uniforms.uSunView.value.set(tmp.x, tmp.y).normalize()
        sky.position.copy(camera.position)
        sky.scale.setScalar(4000)
        water.position.x = Math.round(camera.position.x / 64) * 64
        water.position.z = Math.round(camera.position.z / 64) * 64
    }

    function updateLanterns(dt) {
        const size = halos.geometry.attributes.aSize.array
        const col = halos.geometry.attributes.aColor.array
        const pos = halos.geometry.attributes.position.array
        const first = Math.max(0, flight.nextLantern - 6)
        const night = 0.3 + skyNow.stars * 0.6 + (1 - Math.min(skyNow.elev * 2.2, 1)) * 0.3
        for (let i = 0; i < LANTERNS; i++) {
            const k = first + i
            const l = getLantern(k)
            const bob = Math.sin(clock * 1.3 + k * 1.7) * 0.8
            const got = flight[`got${k}`]
            let pop = pops.get(k)
            if (got && pop === undefined) pops.set(k, (pop = 0))
            if (pop !== undefined) pops.set(k, (pop += dt))
            const gone = pop !== undefined
            dummy.position.set(l.x, l.y + bob, l.z)
            dummy.rotation.set(0, clock * 0.4 + k, 0)
            dummy.scale.setScalar(gone ? 0.0001 : 1.5)
            dummy.updateMatrix()
            lanternMesh.setMatrixAt(i, dummy.matrix)
            pos[i * 3] = l.x
            pos[i * 3 + 1] = l.y + bob
            pos[i * 3 + 2] = l.z
            // A collected lantern flares and fades.
            const flare = gone ? Math.max(0, 1 - pop / 0.5) : 0
            size[i] = gone ? 3200 * (1 + pop * 5) : 2000 + night * 3600
            col[i * 4] = 1
            col[i * 4 + 1] = 0.72
            col[i * 4 + 2] = 0.32
            col[i * 4 + 3] = gone ? flare * 0.9 : night * (0.75 + 0.2 * Math.sin(clock * 3 + k))
        }
        for (const [k, age] of pops) if (age > 1 && k < first) pops.delete(k)
        lanternMesh.instanceMatrix.needsUpdate = true
        halos.geometry.attributes.position.needsUpdate = true
        halos.geometry.attributes.aSize.needsUpdate = true
        halos.geometry.attributes.aColor.needsUpdate = true
    }

    function updateThermals() {
        const pos = thermalPts.geometry.attributes.position.array
        const size = thermalPts.geometry.attributes.aSize.array
        const col = thermalPts.geometry.attributes.aColor.array
        const warm = skyNow.stars > 0.4
        for (let t = 0; t < THERMALS; t++) {
            const th = world.thermal(flight.nextThermal + t)
            for (let i = 0; i < PER; i++) {
                const n = t * PER + i
                const rise = (clock * (13 + (i % 7)) + i * 9.7) % 190
                const a = clock * 0.9 + i * 2.399 + rise * 0.035
                const r = (5 + (i % 9) * 2.4) * (0.7 + rise / 260)
                pos[n * 3] = th.x + Math.cos(a) * r
                pos[n * 3 + 1] = th.y + 2 + rise
                pos[n * 3 + 2] = th.z + Math.sin(a) * r
                size[n] = 150 + (i % 5) * 45
                const fade = Math.min(rise / 20, 1) * (1 - rise / 190)
                col[n * 4] = 1
                col[n * 4 + 1] = warm ? 0.82 : 0.86
                col[n * 4 + 2] = warm ? 0.5 : 0.9
                col[n * 4 + 3] = fade * 0.85
            }
        }
        thermalPts.geometry.attributes.position.needsUpdate = true
        thermalPts.geometry.attributes.aSize.needsUpdate = true
        thermalPts.geometry.attributes.aColor.needsUpdate = true
    }

    function updateMotes() {
        const pos = motes.geometry.attributes.position.array
        const size = motes.geometry.attributes.aSize.array
        const col = motes.geometry.attributes.aColor.array
        world.biomeAt(flight.z, bw)
        const night = skyNow.stars
        // Petals over the river country, sand over the dunes, snow in the peaks, fireflies at night.
        const r = bw[0] * 1.0 + bw[1] * 0.95 + bw[2] * 1.0
        const g = bw[0] * 0.78 + bw[1] * 0.8 + bw[2] * 1.0
        const b = bw[0] * 0.82 + bw[1] * 0.55 + bw[2] * 1.0
        const cx = camera.position.x
        const cy = camera.position.y
        const cz = camera.position.z
        for (let i = 0; i < MOTES; i++) {
            const m = moteSeed[i]
            const wrap = (v, span) => ((v % span) + span) % span
            const x = wrap(m[0] + Math.sin(clock * 0.4 + m[4]) * 4 - cx, 180) - 90
            const y = wrap(m[1] - clock * (2 + m[3] * 2.5) * (1 - night * 0.8) - cy, 90) - 45
            const z = wrap(m[2] - cz, 260) - 215
            pos[i * 3] = cx + x
            pos[i * 3 + 1] = cy + y
            pos[i * 3 + 2] = cz + z
            size[i] = (70 + m[3] * 70) * (1 + night * 0.5)
            const tw = night > 0.4 ? 0.5 + 0.5 * Math.sin(clock * 2 * m[3] + m[4]) : 1
            col[i * 4] = mixn(r, 1.0, night)
            col[i * 4 + 1] = mixn(g, 0.86, night)
            col[i * 4 + 2] = mixn(b, 0.45, night)
            col[i * 4 + 3] = 0.75 * tw
        }
        motes.geometry.attributes.position.needsUpdate = true
        motes.geometry.attributes.aSize.needsUpdate = true
        motes.geometry.attributes.aColor.needsUpdate = true
    }
    const mixn = (a, b, t) => a + (b - a) * t

    function burst(x, y, z, count, colour, speed) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * 6.28
            const u = Math.random() * 2 - 1
            const s = speed * (0.4 + Math.random())
            sparkList.push({ x, y, z, vx: Math.cos(a) * Math.sqrt(1 - u * u) * s, vy: Math.abs(u) * s + 2, vz: Math.sin(a) * Math.sqrt(1 - u * u) * s, age: 0, life: 0.5 + Math.random() * 0.6, colour })
        }
        while (sparkList.length > 64) sparkList.shift()
    }
    function updateSparks(dt) {
        const pos = sparks.geometry.attributes.position.array
        const size = sparks.geometry.attributes.aSize.array
        const col = sparks.geometry.attributes.aColor.array
        for (let i = 0; i < 64; i++) {
            const s = sparkList[i]
            if (!s || s.age > s.life) {
                col[i * 4 + 3] = 0
                continue
            }
            s.age += dt
            s.vy -= 14 * dt
            s.x += s.vx * dt
            s.y += s.vy * dt
            s.z += s.vz * dt
            pos[i * 3] = s.x
            pos[i * 3 + 1] = s.y
            pos[i * 3 + 2] = s.z
            size[i] = 420
            col[i * 4] = s.colour[0]
            col[i * 4 + 1] = s.colour[1]
            col[i * 4 + 2] = s.colour[2]
            col[i * 4 + 3] = Math.max(0, 1 - s.age / s.life)
        }
        sparks.geometry.attributes.position.needsUpdate = true
        sparks.geometry.attributes.aSize.needsUpdate = true
        sparks.geometry.attributes.aColor.needsUpdate = true
    }

    function handle(events) {
        for (const e of events) {
            if (e.type === "lantern") burst(e.x, e.y, e.z, 14, [1, 0.8, 0.4], 9)
            if (e.type === "gate") burst(flight.x, flight.y, flight.z, 22, [1, 0.9, 0.7], 16)
            if (e.type === "crash") {
                const ground = Math.max(world.heightAt(flight.x, flight.z), WATER)
                const wet = e.into === "water"
                for (let i = 0; i < 4; i++) ring(flight.x, ground, flight.z, 26 + i * 16, 1.1 + i * 0.35, wet ? [1, 1, 1] : skyNow.mist)
                burst(flight.x, ground + 1, flight.z, 30, wet ? [0.9, 0.95, 1] : skyNow.mist, 14)
            }
            onEvent(e, { distance: travelled(), lanterns: flight.lanterns, speed: flight.speed, gates: flight.gates, bestCombo: flight.bestCombo, skimSeconds: flight.skimTotal })
        }
    }

    // If frames run slow, draw fewer pixels; if there is room to spare, draw more.
    let resScale = 1
    let frameAvg = 16
    let sinceCheck = 0
    function tick(now) {
        raf = requestAnimationFrame(tick)
        const real = now - last || 16
        const dt = Math.min(real / 1000, 0.05)
        last = now
        if (!frozen && real < 250) {
            frameAvg += (real - frameAvg) * 0.05
            sinceCheck += real
            if (sinceCheck > 1500) {
                sinceCheck = 0
                const next = frameAvg > 24 ? Math.max(0.5, resScale - 0.12) : frameAvg < 15 ? Math.min(1, resScale + 0.06) : resScale
                if (next !== resScale) {
                    resScale = next
                    resize()
                }
            }
        }
        if (!frozen) step(dt)
        draw()
    }

    function step(dt) {
        clock += dt
        shared.uTime.value = clock

        if (mode === "flying") {
            tod += dt / 190
            handle(stepFlight(flight, input, dt, world))
            if (flight.over) {
                mode = "over"
                overFor = 0
            }
        } else if (mode === "attract") {
            tod += dt / 420
            // The waiting plane is held on a string: it follows the valley at a safe height.
            const pilot = autopilot(flight, world)
            flight.yaw += (world.pathYaw(flight.z) + pilot.steer * 0.35 - flight.yaw) * Math.min(1, dt * 2)
            flight.roll += (-pilot.steer * 0.5 - flight.roll) * Math.min(1, dt * 3)
            flight.speed = 30
            const ahead = Math.max(world.heightAt(flight.x, flight.z - 70), world.heightAt(flight.x, flight.z - 30), world.heightAt(flight.x, flight.z), WATER)
            const targetY = ahead + 46
            flight.pitch += (Math.max(-0.2, Math.min(0.25, (targetY - flight.y) * 0.02)) - flight.pitch) * Math.min(1, dt * 2)
            flight.x += Math.sin(flight.yaw) * flight.speed * dt
            flight.z -= Math.cos(flight.yaw) * flight.speed * dt
            flight.y += (targetY - flight.y) * Math.min(1, dt * 0.8)
            flight.nextLantern = Math.max(flight.nextLantern, Math.floor((-flight.z - 320) / 340) * 6)
            while (world.thermal(flight.nextThermal).z > flight.z + 60) flight.nextThermal++
            while (world.gate(flight.nextGate).z > flight.z) flight.nextGate++
        } else {
            overFor += dt
            tod += dt / 420
            // The plane settles where it came down.
            flight.pitch += (0.02 - flight.pitch) * Math.min(1, dt * 4)
            flight.roll += (0.5 - flight.roll) * Math.min(1, dt * 2)
            if (flight.over === "water") flight.y = Math.max(WATER - 0.2, flight.y - dt * 0.6)
        }

        // The wake of a skim.
        if (mode === "flying" && flight.skim > 0) {
            wakeTimer -= dt
            if (wakeTimer <= 0) {
                wakeTimer = 0.07
                const ground = Math.max(world.heightAt(flight.x, flight.z), WATER)
                ring(flight.x, ground, flight.z, 9, 0.7, ground <= WATER ? [1, 1, 1] : skyNow.mist)
            }
        }
        for (const r of rings) {
            if (!r.m.visible) continue
            r.age += dt
            const t = r.age / r.life
            if (t >= 1) {
                r.m.visible = false
                continue
            }
            r.m.scale.setScalar(0.6 + r.grow * (1 - Math.pow(1 - t, 2)))
            r.m.material.opacity = 0.7 * (1 - t)
        }

        applySky()
        world.biomeAt(flight.z, bw)
        waterMat.uniforms.uIce.value = bw[2]
        skyMat.uniforms.uAurora.value = 0.3 + 0.7 * bw[2]
        placeGlider()
        updateCamera(dt)
        trails.forEach((t, i) => updateTrail(t, tipLocal[i]))
        const trailOpacity = mode === "over" ? Math.max(0, 0.6 - overFor) : 0.3 + Math.min(Math.max((flight.speed - 30) / 50, 0), 1) * 0.45
        trails.forEach((t) => (t.mesh.material.uniforms.uOpacity.value = trailOpacity))
        // Shadow under the plane, softer and wider the higher it flies.
        const under = Math.max(world.heightAt(flight.x, flight.z), WATER)
        shadowDisc.position.set(flight.x, under + 0.5, flight.z)
        shadowDisc.scale.setScalar(2.4 + flight.agl * 0.05)
        shadowDisc.material.opacity = mode === "attract" ? 0 : 0.34 * Math.max(0, 1 - flight.agl / 110)

        // Streaks: only in a real dive, longer the faster it goes.
        const rush = mode === "flying" ? Math.min(Math.max((flight.speed - 56) / 36, 0), 1) : 0
        streaks.material.opacity += (rush * 0.42 - streaks.material.opacity) * Math.min(1, dt * 4)
        if (streaks.material.opacity > 0.01) {
            streakTravel += flight.speed * dt * 1.5
            const sp = streakGeo.attributes.position.array
            const len = 3 + rush * 9
            for (let i = 0; i < STREAKS; i++) {
                const q = streakSeed[i]
                const z = -92 + ((q[2] + streakTravel) % 96)
                sp[i * 6] = q[0]
                sp[i * 6 + 1] = q[1]
                sp[i * 6 + 2] = z
                sp[i * 6 + 3] = q[0]
                sp[i * 6 + 4] = q[1]
                sp[i * 6 + 5] = z - len
            }
            streakGeo.attributes.position.needsUpdate = true
        }

        updateChunks(flight.x, flight.z, 1)
        updateGates()
        updateLanterns(dt)
        updateThermals()
        updateMotes()
        updateSparks(dt)

        frameTick += dt
        if (frameTick > 0.1) {
            frameTick = 0
            onFrame({ mode, distance: travelled(), lanterns: flight.lanterns, speed: flight.speed, agl: flight.agl, skim: flight.skim, time: tod % 1, biome: bw })
        }
    }

    function resize() {
        const w = canvas.clientWidth || 1
        const h = canvas.clientHeight || 1
        const dpr = Math.min(window.devicePixelRatio || 1, quality === "low" ? 1.25 : 2) * resScale
        renderer.setPixelRatio(dpr)
        renderer.setSize(w, h, false)
        target.setSize(Math.round(w * dpr), Math.round(h * dpr))
        postMat.uniforms.uAspect.value = w / h
        postMat.uniforms.uTexel.value.set(1.25 / w, 1.25 / h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        const scale = h * dpr * 0.0011
        ;[halos, thermalPts, motes, sparks].forEach((p) => (p.material.uniforms.uScale.value = scale))
    }

    function resetWorld(nextSeed) {
        if (nextSeed !== undefined && nextSeed !== world.seed) {
            world = makeWorld(nextSeed)
            for (const chunk of chunks.values()) {
                chunk.mesh.visible = false
                pool.push(chunk)
            }
            chunks.clear()
            lanternCache.clear()
        }
        gatesFrom = -1
        pops.clear()
        flight = newFlight(world)
        trails.forEach((t) => (t.points.length = 0))
        camReady = false
        placeGlider()
        updateChunks(flight.x, flight.z, 999)
    }

    // ---- Start ---------------------------------------------------------
    applySky()
    resize()
    resetWorld()
    step(0.016)
    raf = requestAnimationFrame(tick)

    return {
        resize,
        // Stop the clock while the app is in the background.
        pause: (v) => (frozen = v),
        setInput(next) {
            input.dive = next.dive || 0
            input.steer = next.steer || 0
        },
        // Leave the title drift and start a real flight from where the plane is.
        begin() {
            if (mode === "flying") return
            if (mode === "over") resetWorld()
            const f = newFlight(world)
            if (mode === "attract") {
                // Keep the place and height the title screen was showing.
                Object.assign(f, { x: flight.x, y: Math.max(flight.y + 30, 80), z: flight.z, yaw: flight.yaw, nextLantern: flight.nextLantern, nextThermal: flight.nextThermal, nextGate: flight.nextGate })
            }
            flight = f
            // Distance counts from here.
            startDistance = -flight.z - 40
            flight.distance = startDistance
            mode = "flying"
        },
        // Back to the title drift, optionally in a new valley.
        reset(nextSeed) {
            resetWorld(nextSeed)
            mode = "attract"
        },
        state: () => ({ mode, x: flight.x, y: flight.y, z: flight.z, speed: flight.speed, agl: flight.agl, lanterns: flight.lanterns, over: flight.over, distance: travelled(), time: tod % 1 }),
        dispose() {
            cancelAnimationFrame(raf)
            target.dispose()
            renderer.dispose()
        },
        // For screenshots and tuning.
        debug: {
            setTime: (t) => (tod = t),
            teleport(z, y) {
                flight.z = z
                flight.x = world.pathX(z)
                flight.yaw = world.pathYaw(z)
                if (y) flight.y = y
                camReady = false
                trails.forEach((t) => (t.points.length = 0))
                updateChunks(flight.x, flight.z, 999)
            },
            freeze: (v) => (frozen = v),
            fullRes() {
                resScale = 1
                resize()
            },
            pilot: () => autopilot(flight, world),
            step,
            renderer,
        },
    }
}
