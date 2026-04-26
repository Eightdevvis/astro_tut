import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const HOTKEY_STORAGE_KEY = 'fgraffiti.hotkey';
const DEFAULT_HOTKEY = ['Enter', '1'];
const FADE_DAYS = 90;
/** Muss mit ERASE_RADIUS_PX in api/graffiti.js uebereinstimmen */
const ERASE_RADIUS = 26;

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
    if (clean.length < 2) return DEFAULT_HOTKEY;
    return clean.slice(0, 2);
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
  const [featureVisible, setFeatureVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState('tag');
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const [strokes, setStrokes] = useState([]);
  const strokesRef = useRef(strokes);
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const baseCanvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const baseDirtyRef = useRef(true);
  const rafRef = useRef(0);
  const modeRef = useRef(mode);
  const pendingEraseVisualRef = useRef(/** @type {{ points: { x: number; y: number }[] } | null} */ (null));
  const pendingCommitVisualRef = useRef(/** @type {{ id: number; mode: string; points: { x: number; y: number }[] }[]} */ ([]));
  const pendingCommitIdRef = useRef(0);
  const pressedRef = useRef(new Set());
  const chordRef = useRef({ ab: false });
  const uiRef = useRef({ visible: false, mode: 'tag' });
  const drawRef = useRef({ active: false, x: 0, y: 0, points: [], functionalHit: false });
  const graffitiListAbortRef = useRef(/** @type {AbortController | null} */ (null));
  const graffitiSyncGenRef = useRef(0);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  useEffect(() => {
    uiRef.current = { visible: featureVisible, mode };
  }, [featureVisible, mode]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (mode !== 'erase') {
      pendingEraseVisualRef.current = null;
      schedulePaint();
    }
  }, [mode]);

  const hintLabel = useMemo(
    () => `${hotkey[0]} + ${hotkey[1]} · Palette weiterschalten`,
    [hotkey]
  );

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
  }, []);

  useEffect(() => {
    const k0 = hotkey[0];
    const k1 = hotkey[1];

    const syncChord = () => {
      chordRef.current = {
        ab: pressedRef.current.has(k0) && pressedRef.current.has(k1),
      };
    };

    const onDown = (e) => {
      if (e.repeat) return;
      const key = normalizeKeyName(e.key);
      if (!key) return;
      pressedRef.current.add(key);

      const ab = pressedRef.current.has(k0) && pressedRef.current.has(k1);
      const prev = chordRef.current;

      if (ab && !prev.ab) {
        e.preventDefault();
        chordRef.current = { ab: true };
        const { visible, mode: m } = uiRef.current;
        if (!visible) {
          setFeatureVisible(true);
          setEnabled(true);
          setMode('tag');
        } else if (m === 'tag') {
          setMode('spray');
          setEnabled(true);
        } else if (m === 'spray') {
          setMode('erase');
          setEnabled(true);
        } else {
          setFeatureVisible(false);
          setEnabled(false);
          setMode('tag');
        }
        return;
      }

      chordRef.current = { ab };
    };

    const onUp = (e) => {
      pressedRef.current.delete(normalizeKeyName(e.key));
      syncChord();
    };

    const onBlur = () => {
      pressedRef.current.clear();
      chordRef.current = { ab: false };
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [hotkey]);

  function drawStrokesOntoContext(ctx, list) {
    for (const stroke of list) {
      const points = Array.isArray(stroke.points) ? stroke.points : [];
      if (points.length < 1) continue;
      const alpha = strokeAlpha(Number(stroke.ageDays || 0));
      if (stroke.mode === 'spray') {
        for (const p of points) {
          drawSprayCloud(ctx, Number(stroke.id || 0), Number(p?.x || 0), Number(p?.y || 0), alpha);
        }
        continue;
      }
      const first = points[0];
      ctx.strokeStyle = '#111';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.globalAlpha = alpha * 0.93;
      ctx.beginPath();
      ctx.moveTo(Number(first?.x || 0), Number(first?.y || 0));
      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        ctx.lineTo(Number(point?.x || 0), Number(point?.y || 0));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function applyEraseVisual(ctx, points) {
    if (!points || points.length < 1) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, ERASE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    const lp = points[points.length - 1];
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(200, 70, 160, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, ERASE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function paintComposite() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const docEl = document.documentElement;
    const docWidth = Math.max(window.innerWidth, docEl.scrollWidth, document.body?.scrollWidth || 0);
    const docHeight = Math.max(window.innerHeight, docEl.scrollHeight, document.body?.scrollHeight || 0);
    const dw = Math.floor(docWidth * ratio);
    const dh = Math.floor(docHeight * ratio);

    if (!baseCanvasRef.current) {
      baseCanvasRef.current = document.createElement('canvas');
    }
    const base = baseCanvasRef.current;

    if (canvas.width !== dw || canvas.height !== dh) {
      canvas.width = dw;
      canvas.height = dh;
      canvas.style.width = `${docWidth}px`;
      canvas.style.height = `${docHeight}px`;
      base.width = dw;
      base.height = dh;
      baseDirtyRef.current = true;
    }

    const bctx = base.getContext('2d');
    if (!bctx) return;

    if (baseDirtyRef.current) {
      bctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      bctx.clearRect(0, 0, docWidth, docHeight);
      drawStrokesOntoContext(bctx, strokesRef.current);
      baseDirtyRef.current = false;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, docWidth, docHeight);
    ctx.drawImage(base, 0, 0, docWidth, docHeight);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const dr = drawRef.current;
    const m = modeRef.current;

    if (dr.active && m === 'tag' && dr.points.length >= 2) {
      ctx.strokeStyle = '#111';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.93;
      ctx.beginPath();
      ctx.moveTo(dr.points[0].x, dr.points[0].y);
      for (let i = 1; i < dr.points.length; i += 1) {
        ctx.lineTo(dr.points[i].x, dr.points[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (dr.active && m === 'spray') {
      for (let i = 0; i < dr.points.length; i += 1) {
        const p = dr.points[i];
        drawSprayCloud(ctx, i, p.x, p.y, 1);
      }
      ctx.globalAlpha = 1;
    }

    const pcs = pendingCommitVisualRef.current;
    for (let c = 0; c < pcs.length; c += 1) {
      const pc = pcs[c];
      if (pc.mode === 'tag' && pc.points.length >= 2) {
        ctx.strokeStyle = '#111';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.93;
        ctx.beginPath();
        ctx.moveTo(pc.points[0].x, pc.points[0].y);
        for (let i = 1; i < pc.points.length; i += 1) {
          ctx.lineTo(pc.points[i].x, pc.points[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (pc.mode === 'spray') {
        for (let i = 0; i < pc.points.length; i += 1) {
          const p = pc.points[i];
          drawSprayCloud(ctx, i + 10000 + c * 1000, p.x, p.y, 1);
        }
        ctx.globalAlpha = 1;
      }
    }

    if (dr.active && m === 'erase' && dr.points.length) {
      applyEraseVisual(ctx, dr.points);
    } else if (m === 'erase' && pendingEraseVisualRef.current?.points?.length) {
      applyEraseVisual(ctx, pendingEraseVisualRef.current.points);
    }
  }

  function schedulePaint() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      paintComposite();
    });
  }

  function flushPaintComposite() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    paintComposite();
  }

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

  useEffect(() => {
    baseDirtyRef.current = true;
    schedulePaint();
  }, [strokes]);

  useEffect(() => {
    function onResize() {
      baseDirtyRef.current = true;
      schedulePaint();
    }
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('load', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('load', onResize);
    };
  }, []);

  function pointerToCanvas(e) {
    return { x: e.pageX, y: e.pageY };
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`fgraffiti-canvas ${enabled ? 'is-active' : ''} ${enabled && mode === 'erase' ? 'is-erase' : ''}`}
        onPointerDown={(e) => {
          if (!enabled) return;
          if (mode !== 'erase') {
            pendingEraseVisualRef.current = null;
          }
          const pos = pointerToCanvas(e);
          drawRef.current = {
            active: true,
            x: pos.x,
            y: pos.y,
            points: [{ x: Math.round(pos.x), y: Math.round(pos.y) }],
            functionalHit: isFunctionalAtPoint(e.clientX, e.clientY),
          };
          if (mode === 'erase') {
            schedulePaint();
            return;
          }
          schedulePaint();
        }}
        onPointerMove={(e) => {
          if (!enabled || !drawRef.current.active) return;
          const pos = pointerToCanvas(e);
          if (mode === 'erase') {
            if (drawRef.current.points.length < 420) {
              drawRef.current.points.push({ x: Math.round(pos.x), y: Math.round(pos.y) });
            }
            if (!drawRef.current.functionalHit) {
              drawRef.current.functionalHit = isFunctionalAtPoint(e.clientX, e.clientY);
            }
            schedulePaint();
            return;
          }
          if (drawRef.current.points.length < 420) {
            drawRef.current.points.push({ x: Math.round(pos.x), y: Math.round(pos.y) });
          }
          if (!drawRef.current.functionalHit) {
            drawRef.current.functionalHit = isFunctionalAtPoint(e.clientX, e.clientY);
          }
          schedulePaint();
        }}
        onPointerUp={async () => {
          if (!drawRef.current.active) return;
          const payload = {
            pagePath: location.pathname,
            mode,
            points: drawRef.current.points,
            isFunctional: drawRef.current.functionalHit,
          };
          const wasErase = mode === 'erase';
          const commitVisualId = !wasErase ? ++pendingCommitIdRef.current : 0;
          const eraseSnap = wasErase ? drawRef.current.points.slice() : null;
          drawRef.current.active = false;
          if (wasErase && eraseSnap?.length) {
            pendingEraseVisualRef.current = { points: eraseSnap };
            pendingCommitVisualRef.current = [];
          } else if (!wasErase) {
            pendingCommitVisualRef.current = [
              ...pendingCommitVisualRef.current,
              { id: commitVisualId, mode, points: drawRef.current.points.slice() },
            ];
            pendingEraseVisualRef.current = null;
          }
          schedulePaint();
          let syncGen = 0;
          try {
            syncGen = ++graffitiSyncGenRef.current;
            const res = await fetch('/api/graffiti', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify(payload),
            });
            if (res.ok) {
              graffitiListAbortRef.current?.abort();
              const listCtl = new AbortController();
              graffitiListAbortRef.current = listCtl;
              let data;
              try {
                const list = await fetch(`/api/graffiti?page=${encodeURIComponent(location.pathname)}`, {
                  credentials: 'same-origin',
                  signal: listCtl.signal,
                });
                data = await list.json().catch(() => ({ strokes: [] }));
              } catch (e) {
                if (e?.name === 'AbortError') return;
                throw e;
              }
              const next = Array.isArray(data?.strokes) ? data.strokes : [];
              if (syncGen !== graffitiSyncGenRef.current) return;
              strokesRef.current = next;
              baseDirtyRef.current = true;
              pendingCommitVisualRef.current = [];
              if (wasErase) pendingEraseVisualRef.current = null;
              setStrokes(next);
              flushPaintComposite();
            } else if (wasErase) {
              if (syncGen === graffitiSyncGenRef.current) {
                pendingEraseVisualRef.current = null;
                flushPaintComposite();
              }
            } else {
              if (syncGen === graffitiSyncGenRef.current) {
                pendingCommitVisualRef.current = pendingCommitVisualRef.current.filter((item) => item.id !== commitVisualId);
                flushPaintComposite();
              }
            }
          } catch (e) {
            if (e?.name === 'AbortError') return;
            if (wasErase) {
              if (syncGen === graffitiSyncGenRef.current) {
                pendingEraseVisualRef.current = null;
                flushPaintComposite();
              }
            } else {
              if (syncGen === graffitiSyncGenRef.current) {
                pendingCommitVisualRef.current = pendingCommitVisualRef.current.filter((item) => item.id !== commitVisualId);
                flushPaintComposite();
              }
            }
          }
        }}
        onPointerLeave={() => {
          if (!drawRef.current.active) return;
          drawRef.current.active = false;
          pendingEraseVisualRef.current = null;
          pendingCommitVisualRef.current = [];
          schedulePaint();
        }}
      />
      {featureVisible ? (
        <button
          type="button"
          className={`fgraffiti-pen ${enabled ? 'is-active' : ''}`}
          title={`fgraffiti: ${hotkey[0]}+${hotkey[1]} schaltet Tag → Spray → Schwamm → aus. Stift: Klick / Doppelklick / Umschalt+Klick.`}
          aria-label={`fgraffiti (${hintLabel})`}
          onClick={(e) => {
            if (e.shiftKey) {
              setMode('erase');
              setEnabled((v) => !v);
              return;
            }
            if (e.detail !== 1) return;
            setMode('tag');
            setEnabled((v) => !v);
          }}
          onDblClick={(e) => {
            e.preventDefault();
            setMode('spray');
            setEnabled(true);
          }}
        >
          {mode === 'erase' ? '🧽' : mode === 'spray' ? '🧯' : '✎'}
        </button>
      ) : null}
      <style>{`
        .fgraffiti-canvas {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 398;
          pointer-events: none;
        }
        .fgraffiti-canvas.is-active {
          pointer-events: auto;
          cursor: crosshair;
        }
        .fgraffiti-canvas.is-active.is-erase {
          cursor: cell;
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
