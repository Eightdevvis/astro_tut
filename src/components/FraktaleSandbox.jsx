import { useEffect, useRef, useState, useCallback } from 'preact/hooks';

const MAX_SHADER_ITER = 512;

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_halfWidth;
uniform vec2 u_juliaC;
uniform float u_mode;
uniform float u_maxIter;
uniform float u_hueOffset;
uniform float u_saturation;

vec2 cx_mul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = h * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgbp = vec3(0.0);
  if (hp < 1.0) rgbp = vec3(c, x, 0.0);
  else if (hp < 2.0) rgbp = vec3(x, c, 0.0);
  else if (hp < 3.0) rgbp = vec3(0.0, c, x);
  else if (hp < 4.0) rgbp = vec3(0.0, x, c);
  else if (hp < 5.0) rgbp = vec3(x, 0.0, c);
  else rgbp = vec3(c, 0.0, x);
  float m = l - 0.5 * c;
  return rgbp + vec3(m);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  float aspect = u_resolution.x / u_resolution.y;
  float halfH = u_halfWidth / aspect;
  vec2 z;
  vec2 c;
  if (u_mode < 0.5) {
    z = vec2(0.0);
    c = u_center + vec2((uv.x - 0.5) * 2.0 * u_halfWidth, -(uv.y - 0.5) * 2.0 * halfH);
  } else {
    z = u_center + vec2((uv.x - 0.5) * 2.0 * u_halfWidth, -(uv.y - 0.5) * 2.0 * halfH);
    c = u_juliaC;
  }

  float sm = 0.0;
  int escaped = 0;
  for (int i = 0; i < ${MAX_SHADER_ITER}; i++) {
    if (i >= int(u_maxIter)) break;
    if (dot(z, z) > 4.0) {
      escaped = 1;
      float len = length(z);
      sm = float(i) + 1.0 - log2(log2(max(len, 1e-6)));
      break;
    }
    z = cx_mul(z, z) + c;
  }

  if (escaped == 0) {
    gl_FragColor = vec4(0.02, 0.02, 0.06, 1.0);
  } else {
    float t = sm / float(u_maxIter);
    float hue = fract(t + u_hueOffset / 360.0);
    vec3 col = hsl2rgb(hue, u_saturation, 0.45 + 0.25 * t);
    gl_FragColor = vec4(col, 1.0);
  }
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(err || 'shader compile');
  }
  return sh;
}

function clientToComplex(canvas, centerX, centerY, halfW, clientX, clientY) {
  if (!canvas) return { re: 0, im: 0 };
  const rect = canvas.getBoundingClientRect();
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  const aspect = rect.width / rect.height;
  const halfH = halfW / aspect;
  const re = centerX + (u - 0.5) * 2 * halfW;
  const im = centerY - (v - 0.5) * 2 * halfH;
  return { re, im };
}

function escapeIterations(px, py, mode, jr, ji, maxIter) {
  let zr = mode === 'mandelbrot' ? 0 : px;
  let zi = mode === 'mandelbrot' ? 0 : py;
  const cr = mode === 'mandelbrot' ? px : jr;
  const ci = mode === 'mandelbrot' ? py : ji;
  for (let i = 0; i < maxIter; i++) {
    const rr = zr * zr - zi * zi;
    const ii = 2 * zr * zi;
    zr = rr + cr;
    zi = ii + ci;
    const m = zr * zr + zi * zi;
    if (m > 4) {
      const len = Math.sqrt(m);
      const sm = i + 1 - Math.log2(Math.log2(Math.max(len, 1e-10)));
      return { escaped: true, smooth: sm, iter: i };
    }
  }
  return { escaped: false, smooth: maxIter, iter: maxIter };
}

export default function FraktaleSandbox() {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const locRef = useRef(null);
  const pointersRef = useRef(new Map());
  const lastPinchDistRef = useRef(null);

  const [mode, setMode] = useState('mandelbrot');
  const [centerX, setCenterX] = useState(-0.5);
  const [centerY, setCenterY] = useState(0);
  const [halfWidth, setHalfWidth] = useState(1.5);
  const [juliaRe, setJuliaRe] = useState(-0.7269);
  const [juliaIm, setJuliaIm] = useState(0.1889);
  const [maxIter, setMaxIter] = useState(256);
  const [hueOffset, setHueOffset] = useState(12);
  const [saturation, setSaturation] = useState(0.85);
  const [cDrive, setCDrive] = useState(false);
  const [probe, setProbe] = useState({ re: 0, im: 0, label: '—' });

  const centerRef = useRef({ x: centerX, y: centerY });
  const halfRef = useRef(halfWidth);
  const juliaRef = useRef({ re: juliaRe, im: juliaIm });
  useEffect(() => {
    centerRef.current = { x: centerX, y: centerY };
  }, [centerX, centerY]);
  useEffect(() => {
    halfRef.current = halfWidth;
  }, [halfWidth]);
  useEffect(() => {
    juliaRef.current = { re: juliaRe, im: juliaIm };
  }, [juliaRe, juliaIm]);

  const initGl = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    glRef.current = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'link');
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    programRef.current = prog;

    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    locRef.current = {
      u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
      u_center: gl.getUniformLocation(prog, 'u_center'),
      u_halfWidth: gl.getUniformLocation(prog, 'u_halfWidth'),
      u_juliaC: gl.getUniformLocation(prog, 'u_juliaC'),
      u_mode: gl.getUniformLocation(prog, 'u_mode'),
      u_maxIter: gl.getUniformLocation(prog, 'u_maxIter'),
      u_hueOffset: gl.getUniformLocation(prog, 'u_hueOffset'),
      u_saturation: gl.getUniformLocation(prog, 'u_saturation'),
    };
  }, []);

  const draw = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const loc = locRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !loc || !canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    const rw = Math.floor(w * dpr);
    const rh = Math.floor(h * dpr);
    if (canvas.width !== rw || canvas.height !== rh) {
      canvas.width = rw;
      canvas.height = rh;
    }
    gl.viewport(0, 0, rw, rh);

    gl.useProgram(program);
    gl.uniform2f(loc.u_resolution, rw, rh);
    gl.uniform2f(loc.u_center, centerRef.current.x, centerRef.current.y);
    gl.uniform1f(loc.u_halfWidth, halfRef.current);
    gl.uniform2f(loc.u_juliaC, juliaRef.current.re, juliaRef.current.im);
    gl.uniform1f(loc.u_mode, mode === 'mandelbrot' ? 0 : 1);
    gl.uniform1f(loc.u_maxIter, Math.min(maxIter, MAX_SHADER_ITER));
    gl.uniform1f(loc.u_hueOffset, hueOffset);
    gl.uniform1f(loc.u_saturation, saturation);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, [mode, maxIter, hueOffset, saturation]);

  useEffect(() => {
    initGl();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(draw);
    });
    if (canvasRef.current) ro.observe(canvasRef.current);
    requestAnimationFrame(draw);
    return () => ro.disconnect();
  }, [initGl, draw]);

  useEffect(() => {
    requestAnimationFrame(draw);
  }, [draw, centerX, centerY, halfWidth, juliaRe, juliaIm, mode, maxIter, hueOffset, saturation]);

  const updateProbe = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const { re, im } = clientToComplex(
      canvas,
      centerRef.current.x,
      centerRef.current.y,
      halfRef.current,
      clientX,
      clientY
    );
    const m = mode;
    const jr = juliaRef.current.re;
    const ji = juliaRef.current.im;
    const r = escapeIterations(re, im, m, jr, ji, Math.min(maxIter, MAX_SHADER_ITER));
    const label = r.escaped
      ? `ñ ≈ ${r.smooth.toFixed(4)}  (${r.iter}+)`
      : 'im Set (≥ max)';
    setProbe({ re, im, label });
  }, [mode, maxIter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        lastPinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }

    function onPointerMove(e) {
      updateProbe(e.clientX, e.clientY);
      const pts = pointersRef.current;
      if (!pts.has(e.pointerId)) return;

      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        const rect = canvas.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        const hw = halfRef.current;
        const hh = hw / aspect;

        if (cDrive && mode === 'julia') {
          const scale = 2.5;
          setJuliaRe((r) => r + (-dx / rect.width) * scale * hw * 2);
          setJuliaIm((i) => i + (dy / rect.height) * scale * hh * 2);
        } else {
          setCenterX((cx) => cx - (dx / rect.width) * 2 * hw);
          setCenterY((cy) => cy + (dy / rect.height) * 2 * hh);
        }
        return;
      }

      if (pts.size >= 2) {
        const ids = [...pts.keys()];
        const a = pts.get(ids[0]);
        const b = pts.get(ids[1]);
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const last = lastPinchDistRef.current;
        if (last != null && last > 1e-6 && d > 1e-6) {
          const factor = d / last;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const rect = canvas.getBoundingClientRect();
          const u = (midX - rect.left) / rect.width;
          const v = (midY - rect.top) / rect.height;
          const aspect = rect.width / rect.height;
          const hw = halfRef.current;
          const halfH = hw / aspect;
          const P = {
            re: centerRef.current.x + (u - 0.5) * 2 * hw,
            im: centerRef.current.y - (v - 0.5) * 2 * halfH,
          };
          const newHalf = Math.min(4, Math.max(1e-7, hw / factor));
          setHalfWidth(newHalf);
          setCenterX(P.re - (u - 0.5) * 2 * newHalf);
          setCenterY(P.im + (v - 0.5) * 2 * (newHalf / aspect));
        }
        lastPinchDistRef.current = d;
      }
    }

    function onPointerUp(e) {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) lastPinchDistRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    function onWheel(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const v = (e.clientY - rect.top) / rect.height;
      const aspect = rect.width / rect.height;
      const hw = halfRef.current;
      const halfH = hw / aspect;
      const P = {
        re: centerRef.current.x + (u - 0.5) * 2 * hw,
        im: centerRef.current.y - (v - 0.5) * 2 * halfH,
      };
      const zoom = Math.exp(-e.deltaY * 0.0012);
      const newHalf = Math.min(4, Math.max(1e-7, hw * zoom));
      setHalfWidth(newHalf);
      setCenterX(P.re - (u - 0.5) * 2 * newHalf);
      setCenterY(P.im + (v - 0.5) * 2 * (newHalf / aspect));
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [cDrive, mode, maxIter, updateProbe]);

  return (
    <div class="fs-root">
      <div class="fs-canvas-wrap">
        <canvas ref={canvasRef} class="fs-canvas" />
        <p class="fs-hint">
          Ziehen: Pan{cDrive && mode === 'julia' ? ' / c verschieben' : ''} · Rad: Zoom · Zwei Finger: Zoom
        </p>
      </div>

      <aside class="fs-panel" aria-label="Parameter und Mathe">
        <div class="fs-row">
          <label class="fs-label">Modus</label>
          <div class="fs-seg">
            <button
              type="button"
              class={mode === 'mandelbrot' ? 'active' : ''}
              onClick={() => setMode('mandelbrot')}
            >
              Mandelbrot
            </button>
            <button
              type="button"
              class={mode === 'julia' ? 'active' : ''}
              onClick={() => setMode('julia')}
            >
              Julia
            </button>
          </div>
        </div>

        {mode === 'julia' && (
          <div class="fs-row">
            <label class="fs-check">
              <input
                type="checkbox"
                checked={cDrive}
                onChange={(e) => setCDrive(e.currentTarget.checked)}
              />
              Ziehen bewegt c (Julia)
            </label>
          </div>
        )}

        <div class="fs-row fs-sliders">
          <label>
            max Iterationen ({maxIter})
            <input
              type="range"
              min="32"
              max="512"
              step="16"
              value={maxIter}
              onInput={(e) => setMaxIter(Number(e.currentTarget.value))}
            />
          </label>
          <label>
            Farbton ({hueOffset}°)
            <input
              type="range"
              min="0"
              max="360"
              value={hueOffset}
              onInput={(e) => setHueOffset(Number(e.currentTarget.value))}
            />
          </label>
          <label>
            Sättigung ({saturation.toFixed(2)})
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={saturation}
              onInput={(e) => setSaturation(Number(e.currentTarget.value))}
            />
          </label>
        </div>

        {mode === 'julia' && (
          <div class="fs-row fs-sliders">
            <label>
              Re(c) ({juliaRe.toFixed(5)})
              <input
                type="range"
                min="-2"
                max="2"
                step="0.0001"
                value={juliaRe}
                onInput={(e) => setJuliaRe(Number(e.currentTarget.value))}
              />
            </label>
            <label>
              Im(c) ({juliaIm.toFixed(5)})
              <input
                type="range"
                min="-2"
                max="2"
                step="0.0001"
                value={juliaIm}
                onInput={(e) => setJuliaIm(Number(e.currentTarget.value))}
              />
            </label>
          </div>
        )}

        <div class="fs-row fs-math">
          <h3 class="fs-math-title">Punkt unter dem Cursor</h3>
          <p class="fs-mono">
            z₀ ≈ {probe.re.toFixed(6)} + {probe.im.toFixed(6)} i
          </p>
          <p class="fs-mono">{probe.label}</p>
          <p class="fs-mono subtle">
            Mitte: {centerX.toFixed(6)} + {centerY.toFixed(6)} i · halbe Breite: {halfWidth.toExponential(3)}
          </p>
          {mode === 'julia' && (
            <p class="fs-mono subtle">
              Julia c = {juliaRe.toFixed(6)} + {juliaIm.toFixed(6)} i
            </p>
          )}
        </div>

        <div class="fs-row">
          <button
            type="button"
            class="fs-btn"
            onClick={() => {
              setCenterX(mode === 'mandelbrot' ? -0.5 : 0);
              setCenterY(0);
              setHalfWidth(1.5);
              if (mode === 'julia') {
                setJuliaRe(-0.7269);
                setJuliaIm(0.1889);
              }
            }}
          >
            Ansicht zurücksetzen
          </button>
        </div>
      </aside>

      <style>{`
        .fs-root {
          display: grid;
          grid-template-columns: 1fr minmax(260px, 340px);
          gap: 1rem;
          align-items: start;
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 0.5rem 1.5rem;
          box-sizing: border-box;
        }
        .fs-canvas-wrap {
          position: relative;
          width: 100%;
          min-height: min(62vh, 560px);
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: #020208;
        }
        .fs-canvas {
          display: block;
          width: 100%;
          height: min(62vh, 560px);
          touch-action: none;
          cursor: grab;
          -webkit-user-select: none;
          user-select: none;
        }
        .fs-canvas:active {
          cursor: grabbing;
        }
        .fs-hint {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          margin: 0;
          padding: 0.4rem 0.6rem;
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.45);
          background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
          pointer-events: none;
        }
        .fs-panel {
          color: rgba(255, 255, 255, 0.88);
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .fs-row {
          margin-bottom: 1rem;
        }
        .fs-label {
          display: block;
          margin-bottom: 0.35rem;
          font-size: 0.8rem;
          opacity: 0.75;
        }
        .fs-seg {
          display: flex;
          gap: 0.35rem;
          flex-wrap: wrap;
        }
        .fs-seg button {
          flex: 1;
          min-width: 120px;
          padding: 0.5rem 0.75rem;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.06);
          color: inherit;
          font: inherit;
          cursor: pointer;
        }
        .fs-seg button.active {
          background: rgba(120, 160, 255, 0.35);
          border-color: rgba(160, 190, 255, 0.5);
        }
        .fs-check {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .fs-sliders label {
          display: block;
          margin-bottom: 0.75rem;
          font-size: 0.8rem;
        }
        .fs-sliders input[type='range'] {
          width: 100%;
        }
        .fs-math {
          padding: 0.75rem;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .fs-math-title {
          margin: 0 0 0.5rem;
          font-size: 0.95rem;
          font-weight: 600;
        }
        .fs-mono {
          margin: 0.25rem 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.78rem;
          word-break: break-all;
        }
        .fs-mono.subtle {
          opacity: 0.7;
        }
        .fs-btn {
          width: 100%;
          padding: 0.55rem 0.75rem;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.08);
          color: inherit;
          font: inherit;
          cursor: pointer;
        }
        .fs-btn:hover {
          background: rgba(255, 255, 255, 0.12);
        }
        @media (max-width: 900px) {
          .fs-root {
            grid-template-columns: 1fr;
          }
          .fs-canvas-wrap {
            min-height: 48vh;
          }
          .fs-canvas {
            height: 48vh;
          }
        }
      `}</style>
    </div>
  );
}
