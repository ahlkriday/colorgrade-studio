# ◈ ColorGrade Studio

A GPU-accelerated, client-side color grading web application with professional-grade presets inspired by cinematic and social media aesthetics.

---

## Architecture

```
User Image → WebGL Texture → GLSL Fragment Shader → Canvas Output → PNG Export
                                      ↑
                              Uniform Parameters
                         (from presets / sliders)
```

All processing is done **100% client-side** using WebGL. No images leave the browser.

### Core Pipeline

1. **Image Upload** → FileReader API → HTMLImageElement
2. **WebGL Engine** → texImage2D loads the image as a GPU texture
3. **Fragment Shader** applies (in order):
   - Exposure (power-of-2 EV stops)
   - White Balance (temperature/tint shifts on R/B/G channels)
   - Contrast (S-curve around 0.5)
   - Lift / Gamma / Gain (3-way color wheels, per-channel)
   - Saturation (HSL conversion in shader)
   - Vignette (radial darkening)
   - Film Grain (noise based on UV + time seed)
4. **Export** → `canvas.toDataURL("image/png")`

---

## Setup

### Option A: Paste into Claude.ai

This is a single `.jsx` file — paste it directly into Claude's artifact runner.

### Option B: Vite + React Project

```bash
npm create vite@latest colorgrade-studio -- --template react
cd colorgrade-studio
npm install
# Replace src/App.jsx with ColorGradeStudio.jsx
npm run dev
```

No additional dependencies required — uses only browser WebGL APIs.

---

## Preset System

Each preset is a plain JS object with named uniform values:

```js
{
  id: "apple_cinematic",
  name: "Apple Cinematic",
  params: {
    exposure: 0.15,          // EV stops: -2 to +2
    contrast: 1.08,          // multiplier: 0.5 to 2.0
    saturation: 0.82,        // multiplier: 0 (B&W) to 2.0
    temperature: 0.25,       // warm/cool: -1 to +1
    tint: 0.05,              // green/magenta: -1 to +1
    lift:  [0.04, 0.02, 0.01],  // [R,G,B] shadow offset
    gamma: [0.96, 0.98, 1.02],  // [R,G,B] midtone power
    gain:  [1.05, 1.0, 0.92],   // [R,G,B] highlight scale
    vignette: 0.3,           // 0 = none, 1 = heavy
    grain: 0.15,             // 0 = none, 1 = heavy
  }
}
```

### Adding a New Preset

1. Add a new object to the `PRESETS` array.
2. Set `lift`/`gamma`/`gain` per channel to shape the color response:
   - **Lift** → adds/subtracts from shadows (raise blacks, add color cast in darks)
   - **Gamma** → power curve on midtones (values <1 brighten, >1 darken)
   - **Gain** → multiplies highlights (boost/crush specific channels in brights)

### Example: Cyberpunk Neon

```js
{
  id: "cyberpunk",
  name: "Cyberpunk",
  icon: "◆",
  description: "Teal shadows · Magenta highlights · High contrast",
  params: {
    exposure: 0.0, contrast: 1.3, saturation: 1.4,
    temperature: -0.1, tint: 0.2,
    lift:  [0.01, 0.04, 0.06],   // blue-green in shadows
    gamma: [1.0,  0.95, 0.95],
    gain:  [1.1,  0.9,  1.15],   // magenta in highlights
    vignette: 0.7, grain: 0.1,
  }
}
```

---

## Filter Implementation Notes

### Apple Cinematic Look
- **Lifted blacks**: `lift: [0.04, 0.02, 0.01]` — prevents true black, adds slight warm cast
- **Warm skin tones**: `temperature: +0.25` + `gain.b: 0.92` removes blue from highlights
- **Slight desaturation**: `saturation: 0.82` — keeps colors present but not oversaturated
- **Midtone rolloff**: `gamma: [0.96, 0.98, 1.02]` adds subtle blue in gamma for "filmic" separation

### Old Money Aesthetic
- **Muted greens/blues**: `saturation: 0.65` + `gain: [1.02, 0.98, 0.88]` kills blue in highlights
- **Warm skin**: `temperature: +0.15` shifts color toward amber
- **Heavy vignette + grain**: `vignette: 0.45, grain: 0.35` — essential for analog feel
- **Crushed mids**: `gamma.b: 0.94` removes cool cast from midtones

---

## Performance Notes

- WebGL renders in < 1ms for typical images (GPU-bound, not CPU-bound)
- `gl.TRIANGLE_STRIP` with 4 vertices = single draw call for full-frame effect
- Grain uses a deterministic `rand(uv + time)` — no texture lookup needed
- For **video**: Extend by drawing each video frame to an offscreen canvas, calling `engine.render()`, then `requestAnimationFrame` loop. Use `canvas.captureStream()` + `MediaRecorder` to export MP4 entirely client-side

### Video Extension (Pseudocode)

```js
const video = document.createElement("video");
const stream = outputCanvas.captureStream(30);
const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

function drawFrame() {
  engine.loadImage(video);
  engine.render(params, video.currentTime * 1000);
  if (!video.ended) requestAnimationFrame(drawFrame);
  else recorder.stop();
}

video.onplay = () => { recorder.start(); drawFrame(); };
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Rendering | WebGL 1.0 (browser-native) |
| Shaders | GLSL ES 1.0 |
| UI | React + inline styles |
| State | React `useState` / `useCallback` |
| Export | `canvas.toDataURL` → `<a>` download |
| Fonts | Google Fonts (DM Sans + DM Mono) |
 
