import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const HOTKEY_STORAGE_KEY = 'fgraffiti.hotkey';
const DRAWING_STORAGE_KEY = 'fgraffiti.overlay.v1';
const DEFAULT_HOTKEY = ['Enter', '1'];

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

function currentThemeMode() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function readSavedImage(themeMode) {
  if (typeof localStorage === 'undefined') return '';
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAWING_STORAGE_KEY) || '{}');
    const key = typeof location !== 'undefined' ? `${location.pathname}::${themeMode}` : '/';
    const value = parsed?.[key];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function saveImage(dataUrl, themeMode) {
  if (typeof localStorage === 'undefined' || typeof location === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAWING_STORAGE_KEY) || '{}');
    parsed[`${location.pathname}::${themeMode}`] = dataUrl;
    localStorage.setItem(DRAWING_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore quota and JSON errors
  }
}

function clearImage(themeMode) {
  if (typeof localStorage === 'undefined' || typeof location === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAWING_STORAGE_KEY) || '{}');
    delete parsed[`${location.pathname}::${themeMode}`];
    localStorage.setItem(DRAWING_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore quota and JSON errors
  }
}

export default function GraffitiLayer() {
  const [userReady, setUserReady] = useState(false);
  const [featureVisible, setFeatureVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState('tag');
  const [themeMode, setThemeMode] = useState('light');
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const pressedRef = useRef(new Set());
  const drawRef = useRef({ active: false, x: 0, y: 0 });
  const saveTimerRef = useRef(/** @type {number | null} */ (null));

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
    setThemeMode(currentThemeMode());
    window.addEventListener('fgraffiti-hotkey-change', sync);
    return () => window.removeEventListener('fgraffiti-hotkey-change', sync);
  }, []);

  useEffect(() => {
    const root = document?.documentElement;
    if (!root) return undefined;
    const observer = new MutationObserver(() => setThemeMode(currentThemeMode()));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!userReady) return undefined;
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

  useEffect(() => {
    if (!userReady) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const prev = canvas.toDataURL('image/png');
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (prev && prev !== 'data:,') {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
        img.src = prev;
      }
    }

    resize();
    const saved = readSavedImage(themeMode);
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
      img.src = saved;
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [themeMode, userReady]);

  function scheduleSave() {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      saveImage(canvas.toDataURL('image/png'), themeMode);
    }, 300);
  }

  function paintTag(x, y) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const prev = drawRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.globalAlpha = 0.93;
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
    ctx.fillStyle = '#101010';
    for (let i = 0; i < 24; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 18;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      const size = Math.random() * 1.8 + 0.5;
      ctx.globalAlpha = 0.1 + Math.random() * 0.45;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
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
          drawRef.current = { active: true, x: pos.x, y: pos.y };
          if (mode === 'spray') paintSpray(pos.x, pos.y);
          else paintTag(pos.x, pos.y);
        }}
        onPointerMove={(e) => {
          if (!enabled || !drawRef.current.active) return;
          const pos = pointerToCanvas(e);
          if (mode === 'spray') paintSpray(pos.x, pos.y);
          else paintTag(pos.x, pos.y);
        }}
        onPointerUp={() => {
          if (!drawRef.current.active) return;
          drawRef.current.active = false;
          scheduleSave();
        }}
        onPointerLeave={() => {
          if (!drawRef.current.active) return;
          drawRef.current.active = false;
          scheduleSave();
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
      {enabled ? (
        <button
          type="button"
          className="fgraffiti-clear"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            clearImage(themeMode);
          }}
        >
          Graffiti loeschen
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
        .fgraffiti-clear {
          position: fixed;
          left: 3rem;
          bottom: 0.6rem;
          z-index: 399;
          border: 1px solid rgba(0,0,0,0.25);
          border-radius: 6px;
          background: rgba(255,255,255,0.82);
          padding: 0.35rem 0.55rem;
          font-size: 0.75rem;
          cursor: pointer;
        }
      `}</style>
    </>
  );
}
