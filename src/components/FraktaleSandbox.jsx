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

  const [sessionUser, setSessionUser] = useState(/** @type {string | null} */ (null));
  const [sessionChecked, setSessionChecked] = useState(false);
  const [snapshots, setSnapshots] = useState(/** @type {Array<{ id: string; mode: string; created_at: string; settings: object }>} */ ([]));
  const [galleryFilter, setGalleryFilter] = useState(/** @type {'all' | 'mandelbrot' | 'julia'} */ ('all'));
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [galleryMsg, setGalleryMsg] = useState('');

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

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user')
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSessionUser(data?.user?.username ?? null);
        setSessionChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSessionUser(null);
          setSessionChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked || !sessionUser) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    setSnapshotsLoading(true);
    const q = galleryFilter === 'all' ? '' : `?mode=${galleryFilter}`;
    fetch(`/api/fractal-snapshots${q}`)
      .then((res) => {
        if (res.status === 401) return { snapshots: [] };
        if (!res.ok) throw new Error('load');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
      })
      .catch(() => {
        if (!cancelled) setSnapshots([]);
      })
      .finally(() => {
        if (!cancelled) setSnapshotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionChecked, sessionUser, galleryFilter]);

  function collectSnapshotPayload() {
    return {
      mode,
      centerX,
      centerY,
      halfWidth,
      juliaRe,
      juliaIm,
      maxIter,
      hueOffset,
      saturation,
      cDrive,
    };
  }

  function applySnapshotSettings(s) {
    if (!s || typeof s !== 'object') return;
    if (s.mode === 'mandelbrot' || s.mode === 'julia') setMode(s.mode);
    if (Number.isFinite(s.centerX)) setCenterX(s.centerX);
    if (Number.isFinite(s.centerY)) setCenterY(s.centerY);
    if (Number.isFinite(s.halfWidth)) setHalfWidth(s.halfWidth);
    if (Number.isFinite(s.juliaRe)) setJuliaRe(s.juliaRe);
    if (Number.isFinite(s.juliaIm)) setJuliaIm(s.juliaIm);
    if (Number.isFinite(s.maxIter)) setMaxIter(Math.round(s.maxIter));
    if (Number.isFinite(s.hueOffset)) setHueOffset(s.hueOffset);
    if (Number.isFinite(s.saturation)) setSaturation(s.saturation);
    setCDrive(Boolean(s.cDrive));
    setGalleryMsg('Ansicht aus Snapshot geladen.');
    setTimeout(() => setGalleryMsg(''), 2500);
  }

  async function saveSnapshot() {
    if (!sessionUser) return;
    setSaveBusy(true);
    setGalleryMsg('');
    try {
      const res = await fetch('/api/fractal-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectSnapshotPayload()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGalleryMsg(data.error || 'Speichern fehlgeschlagen');
        return;
      }
      setGalleryMsg('Snapshot gespeichert.');
      setTimeout(() => setGalleryMsg(''), 2500);
      const q = galleryFilter === 'all' ? '' : `?mode=${galleryFilter}`;
      const list = await fetch(`/api/fractal-snapshots${q}`);
      if (list.ok) {
        const j = await list.json();
        setSnapshots(Array.isArray(j.snapshots) ? j.snapshots : []);
      }
    } catch {
      setGalleryMsg('Netzwerkfehler beim Speichern');
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteSnapshot(id, e) {
    e.stopPropagation();
    if (!sessionUser) return;
    try {
      const res = await fetch(`/api/fractal-snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return;
      setSnapshots((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* ignore */
    }
  }

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
          <p class="fs-mono subtle" style={{ marginBottom: '0.35rem' }}>
            {mode === 'mandelbrot' ? (
              <>
                <strong>c</strong> (Parameter pro Pixel) ≈
              </>
            ) : (
              <>
                <strong>z<sub>0</sub></strong> (Start pro Pixel) ≈
              </>
            )}
          </p>
          <p class="fs-mono">
            {probe.re.toFixed(6)} + {probe.im.toFixed(6)} i
          </p>
          <p class="fs-mono">{probe.label}</p>
          <p class="fs-mono subtle">
            Mitte: {centerX.toFixed(6)} + {centerY.toFixed(6)} i · halbe Breite: {halfWidth.toExponential(3)}
          </p>
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

      <section class="fs-learn" aria-label="Rechenregel und Erklärung">
        <div class="fs-formula-live">
          <h3 class="fs-learn-h">Die Rechenregel (bleibt immer dieselbe)</h3>
          <p class="fs-formula-main">
            z<sub>n+1</sub> = z<sub>n</sub>
            <sup>2</sup> + c
          </p>
          {mode === 'mandelbrot' ? (
            <div class="fs-formula-note">
              <p>
                <strong>Mandelbrot:</strong> Für jeden Bildpunkt ist <strong>c</strong> genau die komplexe Zahl an dieser Stelle in der Ebene, Start{' '}
                <strong>
                  z<sub>0</sub> = 0
                </strong>
                . Wenn du nur verschiebst oder zoomst, ändert sich <em>nicht</em> die Formel oben — nur <strong>welcher Ausschnitt</strong> der c-Ebene gezeichnet wird.
              </p>
              <p class="fs-formula-numline">
                Unter dem Cursor: <strong>c</strong> ≈ {probe.re.toFixed(5)} + {probe.im.toFixed(5)} i
                <span class="fs-formula-hint"> (bewegt sich mit der Maus)</span>
              </p>
            </div>
          ) : (
            <div class="fs-formula-note">
              <p>
                <strong>Julia:</strong> Hier ist <strong>c</strong> für das <em>gesamte</em> Bild fest — jeder Pixel liefert nur den Startwert{' '}
                <strong>
                  z<sub>0</sub>
                </strong>
                . Wenn du <strong>c</strong> verschiebst (Regler oder „Ziehen bewegt c“), ändern sich die Zahlen in der Formel — und damit das ganze Muster.
              </p>
              <p class="fs-formula-numline">
                Aktuell: <strong>c</strong> = {juliaRe.toFixed(5)} + {juliaIm.toFixed(5)} i
              </p>
            </div>
          )}
        </div>

        <details class="fs-learn-details">
          <summary>Mitdenken: warum sieht es so aus?</summary>
          <div class="fs-learn-body">
            <p>
              Eine komplexe Zahl schreibt man als <strong>a + bi</strong> (a und b sind normale reelle Zahlen; <strong>i</strong> ist die imaginäre Einheit).
            </p>
            <p>
              <strong>Mandelbrot:</strong> Man nimmt jeden Punkt der Ebene als <strong>c</strong>, setzt <strong>
                z<sub>0</sub> = 0
              </strong> und wendet immer wieder <strong>
                z<sub>n+1</sub> = z<sub>n</sub>
                <sup>2</sup> + c
              </strong> an. Bleibt die Folge beschränkt (explodiert der Betrag nicht), liegt <strong>c</strong> „im Set“ (dunkel). Die Farben entstehen daraus, <em>wie schnell</em> die Folge nach außen wandert (glatte Iterationszahl).
            </p>
            <p>
              <strong>Julia:</strong> Dieselbe Regel, aber <strong>c</strong> ist einmal gewählt und gilt für alle Pixel; jeder Pixel ist sein eigenes <strong>
                z<sub>0</sub>
              </strong>
              . Deshalb siehst du zu jedem <strong>c</strong> eine andere „Form“.
            </p>
            <p>
              <strong>Zoom:</strong> Du vergrößerst nur einen Ausschnitt derselben Ebene — die Mathe dahinter bleibt, du siehst nur feiner.
            </p>
          </div>
        </details>
      </section>

      <section class="fs-gallery" aria-label="Snapshots">
        <div class="fs-gallery-head">
          <h3 class="fs-gallery-title">Meine Snapshots</h3>
          <div class="fs-gallery-actions">
            {sessionUser && (
              <button type="button" class="fs-btn fs-btn-small" disabled={saveBusy} onClick={saveSnapshot}>
                {saveBusy ? 'Speichern…' : 'Snapshot speichern'}
              </button>
            )}
            <label class="fs-gallery-filter">
              <span class="fs-visually-hidden">Menge filtern</span>
              <select
                value={galleryFilter}
                onChange={(e) => setGalleryFilter(e.currentTarget.value)}
                disabled={!sessionUser}
              >
                <option value="all">Alle Mengen</option>
                <option value="mandelbrot">Mandelbrot</option>
                <option value="julia">Julia</option>
              </select>
            </label>
          </div>
        </div>
        {galleryMsg && <p class="fs-gallery-msg">{galleryMsg}</p>}
        {!sessionChecked && <p class="fs-gallery-hint">Session wird geprüft…</p>}
        {sessionChecked && !sessionUser && (
          <p class="fs-gallery-hint">
            Bitte oben rechts einloggen, um Snapshots zu speichern und deine Galerie zu sehen.
          </p>
        )}
        {sessionUser && snapshotsLoading && <p class="fs-gallery-hint">Lade…</p>}
        {sessionUser && !snapshotsLoading && snapshots.length === 0 && (
          <p class="fs-gallery-hint">Noch keine Snapshots — stell das Fraktal ein und speichere.</p>
        )}
        {sessionUser && snapshots.length > 0 && (
          <ul class="fs-gallery-grid">
            {snapshots.map((sn) => (
              <li key={sn.id}>
                <div
                  class="fs-snap-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => applySnapshotSettings(sn.settings)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      applySnapshotSettings(sn.settings);
                    }
                  }}
                >
                  <span class={`fs-snap-badge fs-snap-badge--${sn.mode}`}>
                    {sn.mode === 'julia' ? 'Julia' : 'Mandelbrot'}
                  </span>
                  <span class="fs-snap-date">
                    {typeof sn.created_at === 'string'
                      ? new Date(sn.created_at.replace(' ', 'T')).toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </span>
                  <span class="fs-snap-meta">
                    Mitte ({Number(sn.settings?.centerX).toFixed(3)}, {Number(sn.settings?.centerY).toFixed(3)}) · Zoom{' '}
                    {Number(sn.settings?.halfWidth).toExponential(2)}
                  </span>
                  {sn.mode === 'julia' && (
                    <span class="fs-snap-meta">
                      c ≈ {Number(sn.settings?.juliaRe).toFixed(3)} + {Number(sn.settings?.juliaIm).toFixed(3)} i
                    </span>
                  )}
                  <button
                    type="button"
                    class="fs-snap-delete"
                    onClick={(e) => deleteSnapshot(sn.id, e)}
                    title="Snapshot löschen"
                    aria-label="Snapshot löschen"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <style>{`
        .fs-root {
          display: grid;
          grid-template-columns: 1fr minmax(260px, 340px);
          gap: 1rem;
          align-items: start;
          width: 100%;
          min-width: 0;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 0.5rem 1.5rem;
          box-sizing: border-box;
        }
        .fs-visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .fs-gallery {
          grid-column: 1 / -1;
          margin-top: 0.5rem;
          padding: 1rem 1rem 1.15rem;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.25);
        }
        .fs-gallery-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.65rem;
        }
        .fs-gallery-title {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.92);
        }
        .fs-gallery-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
        }
        .fs-btn-small {
          width: auto;
          padding: 0.4rem 0.75rem;
          font-size: 0.8rem;
        }
        .fs-gallery-filter select {
          padding: 0.4rem 0.5rem;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.08);
          color: inherit;
          font: inherit;
          font-size: 0.8rem;
        }
        .fs-gallery-msg {
          margin: 0 0 0.5rem;
          font-size: 0.85rem;
          color: rgba(160, 220, 180, 0.95);
        }
        .fs-gallery-hint {
          margin: 0;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.55);
        }
        .fs-gallery-grid {
          list-style: none;
          margin: 0.75rem 0 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
          gap: 0.65rem;
        }
        .fs-snap-card {
          position: relative;
          width: 100%;
          margin: 0;
          padding: 0.65rem 1.6rem 0.65rem 0.65rem;
          text-align: left;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.88);
          cursor: pointer;
          outline: none;
          font: inherit;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .fs-snap-card:hover {
          background: rgba(120, 160, 255, 0.12);
          border-color: rgba(160, 190, 255, 0.35);
        }
        .fs-snap-card:focus-visible {
          box-shadow: 0 0 0 2px rgba(160, 190, 255, 0.5);
        }
        .fs-snap-badge {
          display: inline-block;
          align-self: flex-start;
          font-size: 0.65rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.12);
        }
        .fs-snap-badge--mandelbrot {
          background: rgba(100, 180, 255, 0.25);
        }
        .fs-snap-badge--julia {
          background: rgba(255, 160, 200, 0.2);
        }
        .fs-snap-date {
          font-size: 0.72rem;
          opacity: 0.7;
        }
        .fs-snap-meta {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.65rem;
          line-height: 1.35;
          opacity: 0.88;
          word-break: break-all;
        }
        .fs-snap-delete {
          position: absolute;
          top: 0.2rem;
          right: 0.25rem;
          width: 1.5rem;
          height: 1.5rem;
          line-height: 1.4rem;
          padding: 0;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: rgba(255, 255, 255, 0.45);
          font-size: 1.1rem;
          cursor: pointer;
        }
        .fs-snap-delete:hover {
          color: #f88;
          background: rgba(255, 255, 255, 0.08);
        }
        .fs-learn {
          grid-column: 1 / -1;
          margin-top: 0.25rem;
          padding: 1rem 1rem 1.1rem;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.03);
        }
        .fs-formula-live {
          margin-bottom: 0.75rem;
        }
        .fs-learn-h {
          margin: 0 0 0.5rem;
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.92);
        }
        .fs-formula-main {
          margin: 0 0 0.75rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 1.15rem;
          letter-spacing: 0.02em;
          color: rgba(200, 220, 255, 0.98);
        }
        .fs-formula-note p {
          margin: 0 0 0.65rem;
          font-size: 0.88rem;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.82);
        }
        .fs-formula-numline {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.82rem;
          padding: 0.5rem 0.65rem;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: rgba(230, 240, 255, 0.95);
        }
        .fs-formula-hint {
          font-family: inherit;
          font-size: 0.78rem;
          opacity: 0.65;
        }
        .fs-learn-details {
          margin-top: 0.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 0.65rem;
        }
        .fs-learn-details summary {
          cursor: pointer;
          font-size: 0.88rem;
          font-weight: 600;
          color: rgba(180, 210, 255, 0.95);
          list-style: none;
        }
        .fs-learn-details summary::-webkit-details-marker {
          display: none;
        }
        .fs-learn-details summary::before {
          content: '▸ ';
          opacity: 0.7;
        }
        .fs-learn-details[open] summary::before {
          content: '▾ ';
        }
        .fs-learn-body {
          margin-top: 0.65rem;
          padding-left: 0.15rem;
        }
        .fs-learn-body p {
          margin: 0 0 0.65rem;
          font-size: 0.85rem;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.78);
        }
        .fs-learn-body p:last-child {
          margin-bottom: 0;
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
