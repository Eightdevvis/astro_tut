import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const HOTKEY_STORAGE_KEY = 'fgraffiti.hotkey';
const DEFAULT_HOTKEY = ['Enter', '1'];
const FADE_DAYS = 90;

function normalizeKeyName(key) {
  if (!key) return '';
  if (key === ' ') return 'Space';
  if (key === 'Esc') return 'Escape';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function readHotkey() {
  if (typeof localStorage === 'undefined') return DEFAULT_HOTKEY;
  try {
    const raw = localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (!raw) return DEFAULT_HOTKEY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2) return DEFAULT_HOTKEY;
    const clean = parsed.map((k) => normalizeKeyName(String(k))).filter(Boolean);
    return clean.length >= 2 ? clean.slice(0, 2) : DEFAULT_HOTKEY;
  } catch {
    return DEFAULT_HOTKEY;
  }
}

function seededRng(seed) {
  let t = seed + 0x6d2b79f5;
  return function next() {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strokeAlpha(ageDays) {
  const progress = Math.max(0, Math.min(1, ageDays / FADE_DAYS));
  return Math.max(0.06, 1 - progress);
}

function isFunctionalAtPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return false;
  return Boolean(
    el.closest(
      'nav, .nav2, .nav2-strip, header, h1, h2, h3, blockquote, .quote, a, button, input, textarea, select, summary, [role="navigation"]'
    )
  );
}

export default function GraffitiLayer() {
  const [userReady, setUserReady] = useState(false);
  const [featureVisible, setFeatureVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState('tag');
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const [strokes, setStrokes] = useState([]);
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const pressedRef = useRef(new Set());
  const drawRef = useRef({ active: false, x: 0, y: 0, points: [], functionalHit: false });

  const hintLabel = useMemo(() => `${hotkey[0]} + ${hotkey[1]}`, [hotkey]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setUserReady(Boolean(data?.user));
      })
      .catch(() => {
        if (!cancelled) setUserReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sync = () => setHotkey(readHotkey());
    sync();
    window.addEventListener('fgraffiti-hotkey-change', sync);
    return () => window.removeEventListener('fgraffiti-hotkey-change', sync);
  }, []);

  useEffect(() => {
    const page = typeof location !== 'undefined' ? location.pathname : '/';
    fetch(`/api/graffiti?page=${encodeURIComponent(page)}`)
      .then((res) => (res.ok ? res.json() : { strokes: [] }))
      .then((data) => setStrokes(Array.isArray(data?.strokes) ? data.strokes : []))
      .catch(() => setStrokes([]));
  }, [userReady]);

  useEffect(() => {
    if (!userReady) return;
    const onDown = (e) => {
      const key = normalizeKeyName(e.key);
      if (!key) return;
      pressedRef.current.add(key);
      if (hotkey.every((k) => pressedRef.current.has(k))) {
        e.preventDefault();
        setFeatureVisible((v) => {
          const next = !v;
          setEnabled(next);
          return next;
        });
      }
    };
    const onUp = (e) => pressedRef.current.delete(normalizeKeyName(e.key));
    const onBlur = () => pressedRef.current.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [hotkey, userReady]);

  function drawSprayCloud(ctx, strokeId, x, y, alpha) {
    const random = seededRng((strokeId * 1315423911 + x * 31 + y * 17) | 0);
    ctx.fillStyle = '#101010';
    for (let i = 0; i < 20; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = random() * 18;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      const size = random() * 1.8 + 0.5;
      ctx.globalAlpha = alpha * (0.15 + random() * 0.45);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function renderAll() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const stroke of strokes) {
        const points = Array.isArray(stroke.points) ? stroke.points : [];
        if (points.length < 1) continue;
        const alpha = strokeAlpha(Number(stroke.ageDays || 0));
        if (stroke.mode === 'spray') {
          for (const p of points) {
            drawSprayCloud(ctx, Number(stroke.id || 0), Number(p.x || 0), Number(p.y || 0), alpha);
          }
          continue;
        }
        ctx.strokeStyle = '#111';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.globalAlpha = alpha * 0.93;
        ctx.beginPath();
        ctx.moveTo(Number(points[0].x || 0), Number(points[0].y || 0));
        for (let i = 1; i < points.length; i += 1) {
          ctx.lineTo(Number(points[i].x || 0), Number(points[i].y || 0));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }

  useEffect(() => renderAll(), [strokes, userReady]);

  function paintTag(x, y, alpha = 0.93) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const prev = drawRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    drawRef.current.x = x;
    drawRef.current.y = y;
  }

  function paintSpray(x, y) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawSprayCloud(ctx, Date.now() % 100000, x, y, 1);
    ctx.globalAlpha = 1;
  }

  function pointerToCanvas(e) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  if (!userReady) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`fgraffiti-canvas ${enabled ? 'is-active' : ''}`}
        onPointerDown={(e) => {
          if (!enabled) return;
          const pos = pointerToCanvas(e);
          drawRef.current = {
            active: true,
            x: pos.x,
            y: pos.y,
            points: [{ x: Math.round(pos.x), y: Math.round(pos.y) }],
            functionalHit: isFunctionalAtPoint(e.clientX, e.clientY),
          };
          if (mode === 'spray') paintSpray(pos.x, pos.y);
          else paintTag(pos.x, pos.y);
        }}
        onPointerMove={(e) => {
          if (!enabled || !drawRef.current.active) return;
          const pos = pointerToCanvas(e);
          if (mode === 'spray') paintSpray(pos.x, pos.y);
          else paintTag(pos.x, pos.y);
          if (drawRef.current.points.length < 420) {
            drawRef.current.points.push({ x: Math.round(pos.x), y: Math.round(pos.y) });
          }
          if (!drawRef.current.functionalHit) {
            drawRef.current.functionalHit = isFunctionalAtPoint(e.clientX, e.clientY);
          }
        }}
        onPointerUp={async () => {
          if (!drawRef.current.active) return;
          const payload = {
            pagePath: location.pathname,
            mode,
            points: drawRef.current.points,
            isFunctional: drawRef.current.functionalHit,
          };
          drawRef.current.active = false;
          try {
            const res = await fetch('/api/graffiti', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify(payload),
            });
            if (res.ok) {
              const list = await fetch(`/api/graffiti?page=${encodeURIComponent(location.pathname)}`, {
                credentials: 'same-origin',
              });
              const data = await list.json().catch(() => ({ strokes: [] }));
              setStrokes(Array.isArray(data?.strokes) ? data.strokes : []);
            }
          } catch {
            // keep local paint; next reload will fetch server state
          }
        }}
        onPointerLeave={() => {
          if (!drawRef.current.active) return;
          drawRef.current.active = false;
        }}
      />
      {featureVisible ? (
        <button
          type="button"
          className={`fgraffiti-pen ${enabled ? 'is-active' : ''}`}
          title={`fgraffiti (${hintLabel})`}
          aria-label={`fgraffiti aktivieren (${hintLabel})`}
          onClick={() => {
            setMode('tag');
            setEnabled((v) => !v);
          }}
          onDblClick={() => {
            setMode('spray');
            setEnabled((v) => !v);
          }}
        >
          {mode === 'spray' ? '🧯' : '✎'}
        </button>
      ) : null}
      <style>{`
        .fgraffiti-canvas {
          position: fixed;
          inset: 0;
          z-index: 398;
          pointer-events: none;
        }
        .fgraffiti-canvas.is-active {
          pointer-events: auto;
          cursor: crosshair;
        }
        .fgraffiti-pen {
          position: fixed;
          left: 0.35rem;
          bottom: -0.1rem;
          z-index: 399;
          width: 2.2rem;
          height: 3rem;
          border: 1px solid rgba(0,0,0,0.35);
          border-radius: 0.6rem 0.6rem 0 0;
          background: rgba(255,255,255,0.72);
          cursor: pointer;
          font-size: 1.25rem;
          line-height: 1;
          padding: 0;
        }
        .fgraffiti-pen.is-active {
          background: rgba(255, 247, 154, 0.86);
        }
      `}</style>
    </>
  );
}
