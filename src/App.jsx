import { useState, useRef, useEffect, useCallback } from "react";

// ─── WebGL Shader Sources ─────────────────────────────────────────────────────

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform vec3 u_lift;
  uniform vec3 u_gamma;
  uniform vec3 u_gain;
  uniform float u_saturation;
  uniform float u_exposure;
  uniform float u_contrast;
  uniform float u_temperature;
  uniform float u_tint;
  uniform float u_vignette;
  uniform float u_grain;
  uniform float u_time;
  varying vec2 v_texCoord;

  vec3 rgbToHsl(vec3 color) {
    float maxC = max(color.r, max(color.g, color.b));
    float minC = min(color.r, min(color.g, color.b));
    float l = (maxC + minC) / 2.0;
    float s = 0.0;
    float h = 0.0;
    if (maxC != minC) {
      float d = maxC - minC;
      s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
      if (maxC == color.r) h = (color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0);
      else if (maxC == color.g) h = (color.b - color.r) / d + 2.0;
      else h = (color.r - color.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, s, l);
  }

  float hueToRgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
  }

  vec3 hslToRgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    if (s == 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hueToRgb(p, q, h + 1.0/3.0), hueToRgb(p, q, h), hueToRgb(p, q, h - 1.0/3.0));
  }

  float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
  }

  vec3 applyLiftGammaGain(vec3 color) {
    color = color * u_gain + u_lift;
    color = pow(max(color, 0.0), 1.0 / max(u_gamma, vec3(0.001)));
    return color;
  }

  void main() {
    vec4 texColor = texture2D(u_image, v_texCoord);
    vec3 color = texColor.rgb;

    // Exposure
    color *= pow(2.0, u_exposure);

    // Temperature & Tint (white balance)
    color.r += u_temperature * 0.1;
    color.b -= u_temperature * 0.1;
    color.g += u_tint * 0.05;

    // Contrast (S-curve around 0.5)
    color = (color - 0.5) * u_contrast + 0.5;
    color = clamp(color, 0.0, 1.0);

    // Lift / Gamma / Gain (3-way color wheels)
    color = applyLiftGammaGain(color);
    color = clamp(color, 0.0, 1.0);

    // Saturation
    vec3 hsl = rgbToHsl(color);
    hsl.y = clamp(hsl.y * u_saturation, 0.0, 1.0);
    color = hslToRgb(hsl);

    // Vignette
    vec2 uv = v_texCoord - 0.5;
    float vignetteFactor = 1.0 - dot(uv, uv) * u_vignette * 3.0;
    color *= clamp(vignetteFactor, 0.0, 1.0);

    // Film Grain
    if (u_grain > 0.0) {
      float noise = rand(v_texCoord + vec2(u_time * 0.001)) * 2.0 - 1.0;
      color += noise * u_grain * 0.08;
    }

    color = clamp(color, 0.0, 1.0);
    gl_FragColor = vec4(color, texColor.a);
  }
`;

// ─── Preset Definitions ───────────────────────────────────────────────────────

const PRESETS = [
  {
    id: "none",
    name: "Original",
    icon: "◎",
    description: "No filter applied",
    params: {
      exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0,
      lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
      vignette: 0, grain: 0,
    },
  },
  {
    id: "apple_cinematic",
    name: "Apple Cinematic",
    icon: "◈",
    description: "Warm tones · Lifted blacks · Skin-friendly",
    params: {
      exposure: 0.15, contrast: 1.08, saturation: 0.82, temperature: 0.25, tint: 0.05,
      lift: [0.04, 0.02, 0.01], gamma: [0.96, 0.98, 1.02], gain: [1.05, 1.0, 0.92],
      vignette: 0.3, grain: 0.15,
    },
  },
  {
    id: "old_money",
    name: "Old Money",
    icon: "◇",
    description: "Muted greens · Warm skin · Film grain",
    params: {
      exposure: -0.1, contrast: 1.05, saturation: 0.65, temperature: 0.15, tint: -0.05,
      lift: [0.03, 0.03, 0.02], gamma: [1.0, 0.97, 0.94], gain: [1.02, 0.98, 0.88],
      vignette: 0.45, grain: 0.35,
    },
  },
  {
    id: "moody_cinematic",
    name: "Moody Cinema",
    icon: "◉",
    description: "Deep shadows · Cool tones · Desaturated",
    params: {
      exposure: -0.25, contrast: 1.18, saturation: 0.72, temperature: -0.3, tint: 0,
      lift: [0.0, 0.01, 0.03], gamma: [0.93, 0.95, 1.0], gain: [0.92, 0.96, 1.08],
      vignette: 0.6, grain: 0.2,
    },
  },
  {
    id: "instagram_warm",
    name: "IG Warm",
    icon: "◑",
    description: "Vibrant · High contrast · Golden hour",
    params: {
      exposure: 0.1, contrast: 1.15, saturation: 1.25, temperature: 0.4, tint: 0.1,
      lift: [0.02, 0.01, -0.01], gamma: [0.98, 0.98, 1.0], gain: [1.08, 1.02, 0.88],
      vignette: 0.2, grain: 0.05,
    },
  },
  {
    id: "vintage_film",
    name: "Vintage Film",
    icon: "◐",
    description: "Teal & orange · Film grain · Light leak",
    params: {
      exposure: -0.05, contrast: 1.1, saturation: 0.9, temperature: 0.2, tint: -0.1,
      lift: [0.02, 0.04, 0.05], gamma: [1.0, 0.96, 0.9], gain: [1.06, 0.98, 0.85],
      vignette: 0.5, grain: 0.5,
    },
  },
];

// ─── WebGL Engine ─────────────────────────────────────────────────────────────

function createWebGLEngine(canvas) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, alpha: true });
  if (!gl) return null;

  function compileShader(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);

  const posBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const texBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1, 1,1, 0,0, 1,0]), gl.STATIC_DRAW);
  const texLoc = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(texLoc);
  gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  function setUniform1f(name, val) { gl.uniform1f(gl.getUniformLocation(program, name), val); }
  function setUniform3f(name, a, b, c) { gl.uniform3f(gl.getUniformLocation(program, name), a, b, c); }

  return {
    gl,
    loadImage(img) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    },
    render(params, time = 0) {
      const { exposure, contrast, saturation, temperature, tint, lift, gamma, gain, vignette, grain } = params;
      gl.viewport(0, 0, canvas.width, canvas.height);
      setUniform1f("u_exposure", exposure);
      setUniform1f("u_contrast", contrast);
      setUniform1f("u_saturation", saturation);
      setUniform1f("u_temperature", temperature);
      setUniform1f("u_tint", tint);
      setUniform3f("u_lift", ...lift);
      setUniform3f("u_gamma", ...gamma);
      setUniform3f("u_gain", ...gain);
      setUniform1f("u_vignette", vignette);
      setUniform1f("u_grain", grain);
      setUniform1f("u_time", time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    toDataURL() { return canvas.toDataURL("image/png"); },
  };
}

// ─── Slider Component ─────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step = 0.01, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", fontFamily: "'DM Mono', monospace" }}>{label}</span>
        <span style={{ fontSize: "11px", color: "#ccc", fontFamily: "'DM Mono', monospace" }}>{value > 0 && label !== "Saturation" && label !== "Contrast" ? "+" : ""}{typeof value === "number" ? value.toFixed(2) : value}</span>
      </div>
      <div style={{ position: "relative", height: "3px", background: "#222", borderRadius: "2px" }}>
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #7c5cbf, #e87040)", borderRadius: "2px" }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", inset: "-6px 0", width: "100%", opacity: 0, cursor: "pointer", height: "16px" }}
        />
        <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%, -50%)", width: "12px", height: "12px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(232,112,64,0.6)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function ColorGradeStudio() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const imageRef = useRef(null);
  const fileInputRef = useRef(null);
  const animFrameRef = useRef(null);

  const [hasImage, setHasImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("none");
  const [activeTab, setActiveTab] = useState("presets"); // presets | adjust
  const [params, setParams] = useState(PRESETS[0].params);
  const [imageName, setImageName] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const renderFrame = useCallback(() => {
    if (engineRef.current && imageRef.current) {
      engineRef.current.render(params, performance.now());
    }
  }, [params]);

  useEffect(() => { renderFrame(); }, [renderFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    engineRef.current = createWebGLEngine(canvas);
  }, []);

  const loadImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        const canvas = canvasRef.current;
        const maxW = 1400, maxH = 900;
        let w = img.width, h = img.height;
        if (w > maxW) { h = (h * maxW) / w; w = maxW; }
        if (h > maxH) { w = (w * maxH) / h; h = maxH; }
        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
        engineRef.current.loadImage(img);
        engineRef.current.render(params, performance.now());
        setHasImage(true);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, [params]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    loadImageFile(e.dataTransfer.files[0]);
  }, [loadImageFile]);

  const applyPreset = useCallback((presetId) => {
    setSelectedPreset(presetId);
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) setParams({ ...preset.params });
  }, []);

  const handleExport = useCallback(() => {
    if (!hasImage) return;
    setIsExporting(true);
    setTimeout(() => {
      const dataURL = engineRef.current.toDataURL();
      const a = document.createElement("a");
      a.href = dataURL;
      a.download = `graded_${imageName || "image"}.png`;
      a.click();
      setIsExporting(false);
    }, 100);
  }, [hasImage, imageName]);

  const updateParam = useCallback((key, val) => {
    setParams(p => ({ ...p, [key]: val }));
    setSelectedPreset("custom");
  }, []);

  const currentPreset = PRESETS.find(p => p.id === selectedPreset);

  return (
    <div style={{
      display: "flex", height: "100vh", background: "#0a0a0a", color: "#fff",
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", overflow: "hidden",
    }}>
      {/* Left Sidebar */}
      <div style={{
        width: "72px", background: "#0d0d0d", borderRight: "1px solid #1a1a1a",
        display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0", gap: "8px",
        flexShrink: 0,
      }}>
        <div style={{ fontSize: "22px", marginBottom: "16px", background: "linear-gradient(135deg, #7c5cbf, #e87040)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>◈</div>
        {[
          { id: "presets", icon: "▦", label: "Presets" },
          { id: "adjust", icon: "⊞", label: "Adjust" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} title={tab.label} style={{
            width: "44px", height: "44px", borderRadius: "10px", border: "none", cursor: "pointer",
            background: activeTab === tab.id ? "rgba(124,92,191,0.2)" : "transparent",
            color: activeTab === tab.id ? "#b08aff" : "#555", fontSize: "18px",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}>{tab.icon}</button>
        ))}
      </div>

      {/* Panel */}
      <div style={{
        width: "260px", background: "#0d0d0d", borderRight: "1px solid #1a1a1a",
        display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden",
      }}>
        {/* Panel Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#555", marginBottom: "4px", fontFamily: "'DM Mono', monospace" }}>
            {activeTab === "presets" ? "Color Grades" : "Adjustments"}
          </div>
          <div style={{ fontSize: "18px", fontWeight: "600", color: "#eee" }}>
            {activeTab === "presets" ? "Presets" : "Fine-Tune"}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {activeTab === "presets" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {PRESETS.map(preset => (
                <button key={preset.id} onClick={() => applyPreset(preset.id)} style={{
                  background: selectedPreset === preset.id ? "rgba(124,92,191,0.15)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${selectedPreset === preset.id ? "rgba(124,92,191,0.4)" : "#1e1e1e"}`,
                  borderRadius: "10px", padding: "12px 14px", cursor: "pointer", textAlign: "left",
                  transition: "all 0.2s", color: "#fff",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "18px", color: selectedPreset === preset.id ? "#b08aff" : "#555" }}>{preset.icon}</span>
                    <span style={{ fontSize: "13px", fontWeight: "600", color: selectedPreset === preset.id ? "#ddd" : "#aaa" }}>{preset.name}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.4", paddingLeft: "28px" }}>{preset.description}</div>
                </button>
              ))}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#444", marginBottom: "12px", fontFamily: "'DM Mono', monospace" }}>Tone</div>
                <Slider label="Exposure" value={params.exposure} min={-2} max={2} onChange={v => updateParam("exposure", v)} />
                <Slider label="Contrast" value={params.contrast} min={0.5} max={2} onChange={v => updateParam("contrast", v)} />
                <Slider label="Saturation" value={params.saturation} min={0} max={2} onChange={v => updateParam("saturation", v)} />
              </div>
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#444", marginBottom: "12px", fontFamily: "'DM Mono', monospace" }}>White Balance</div>
                <Slider label="Temperature" value={params.temperature} min={-1} max={1} onChange={v => updateParam("temperature", v)} />
                <Slider label="Tint" value={params.tint} min={-1} max={1} onChange={v => updateParam("tint", v)} />
              </div>
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#444", marginBottom: "12px", fontFamily: "'DM Mono', monospace" }}>Style</div>
                <Slider label="Vignette" value={params.vignette} min={0} max={1} onChange={v => updateParam("vignette", v)} />
                <Slider label="Grain" value={params.grain} min={0} max={1} onChange={v => updateParam("grain", v)} />
              </div>
              <button onClick={() => applyPreset("none")} style={{
                width: "100%", padding: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid #222",
                borderRadius: "8px", color: "#666", fontSize: "12px", cursor: "pointer", letterSpacing: "0.05em",
              }}>Reset to Original</button>
            </div>
          )}
        </div>

        {/* Export Button */}
        <div style={{ padding: "16px", borderTop: "1px solid #1a1a1a" }}>
          <button onClick={handleExport} disabled={!hasImage || isExporting} style={{
            width: "100%", padding: "12px", borderRadius: "10px", border: "none", cursor: hasImage ? "pointer" : "not-allowed",
            background: hasImage ? "linear-gradient(135deg, #7c5cbf, #e87040)" : "#1a1a1a",
            color: hasImage ? "#fff" : "#444", fontWeight: "600", fontSize: "13px", letterSpacing: "0.05em",
            transition: "opacity 0.2s", opacity: isExporting ? 0.7 : 1,
          }}>
            {isExporting ? "Exporting…" : "Export PNG"}
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top Bar */}
        <div style={{
          height: "52px", borderBottom: "1px solid #1a1a1a", display: "flex",
          alignItems: "center", padding: "0 24px", gap: "16px", flexShrink: 0,
        }}>
          <span style={{ fontSize: "13px", color: "#444" }}>
            {hasImage ? (
              <><span style={{ color: "#666" }}>{imageName}</span> · <span style={{ color: selectedPreset === "none" ? "#555" : "#b08aff" }}>{currentPreset?.name || "Custom"}</span></>
            ) : "No image loaded"}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={() => fileInputRef.current?.click()} style={{
            padding: "7px 16px", background: "rgba(255,255,255,0.05)", border: "1px solid #2a2a2a",
            borderRadius: "8px", color: "#aaa", fontSize: "12px", cursor: "pointer", letterSpacing: "0.05em",
          }}>Open Image</button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => loadImageFile(e.target.files[0])} />
        </div>

        {/* Canvas */}
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
            background: isDragging ? "rgba(124,92,191,0.05)" : "#0a0a0a",
            border: isDragging ? "2px dashed rgba(124,92,191,0.4)" : "2px solid transparent",
            transition: "all 0.2s",
          }}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {/* Subtle grid background */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            pointerEvents: "none",
          }} />

          <canvas ref={canvasRef} style={{
            display: hasImage ? "block" : "none",
            maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
            boxShadow: "0 8px 60px rgba(0,0,0,0.8)",
          }} />

          {!hasImage && (
            <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
              <div style={{
                width: "80px", height: "80px", borderRadius: "20px", margin: "0 auto 20px",
                background: "rgba(124,92,191,0.1)", border: "1px solid rgba(124,92,191,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px",
              }}>◈</div>
              <div style={{ fontSize: "22px", fontWeight: "600", color: "#444", marginBottom: "8px" }}>
                Drop your image here
              </div>
              <div style={{ fontSize: "14px", color: "#333", marginBottom: "24px" }}>
                or click to browse · JPG, PNG, WebP supported
              </div>
              <button onClick={() => fileInputRef.current?.click()} style={{
                padding: "12px 28px", background: "linear-gradient(135deg, rgba(124,92,191,0.3), rgba(232,112,64,0.3))",
                border: "1px solid rgba(124,92,191,0.4)", borderRadius: "10px",
                color: "#b08aff", fontSize: "14px", cursor: "pointer", fontWeight: "500",
                letterSpacing: "0.05em",
              }}>Choose Image</button>
            </div>
          )}
        </div>

        {/* Bottom Info Bar */}
        <div style={{
          height: "32px", borderTop: "1px solid #1a1a1a", display: "flex",
          alignItems: "center", padding: "0 24px", gap: "24px",
        }}>
          {[
            ["WebGL", "GPU Accelerated"],
            ["Engine", "GLSL Shaders"],
            ["LGG", "Lift·Gamma·Gain"],
          ].map(([k, v]) => (
            <span key={k} style={{ fontSize: "11px", color: "#333", fontFamily: "'DM Mono', monospace" }}>
              <span style={{ color: "#444" }}>{k}</span> · {v}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; }
        button { font-family: inherit; }
      `}</style>
    </div>
  );
}
