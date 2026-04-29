import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  TILE_SIZE,
  tilesCoveringBounds,
  fetchTilesForPage,
  extractTilePngBase64,
  uploadTile,
  getStrokeBounds,
  loadTileImageFromBase64,
} from '../lib/graffiti-client.js';

const HOTKEY_STORAGE_KEY = 'fgraffiti.hotkey';
const DEFAULT_HOTKEY = ['Enter', '1'];
/** Schwamm-Radius in CSS-Pixeln. Muss konsistent mit Server-/Tile-Render-Logik sein. */
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
  // tiles: Map<"x:y", { x, y, version, image: HTMLImageElement }>
  // Jeder Eintrag ist ein bereits dekodiertes Tile-Image bereit zum drawImage.
  const [tiles, setTiles] = useState(() => new Map());
  const tilesRef = useRef(tiles);
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const baseCanvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const baseDirtyRef = useRef(true);
  const rafRef = useRef(0);
  const modeRef = useRef(mode);
  // Index-Cursor fuer den inkrementellen Schwamm-Commit:
  // Punkte 0..eraseCommittedUpToRef-1 wurden bereits ins Base-Canvas gezeichnet
  // (destination-out). Pro Frame werden nur die Punkte ab diesem Index neu commited,
  // damit nicht jeder Frame die ganze Schwamm-Spur neu malt.
  const eraseCommittedUpToRef = useRef(0);
  const pressedRef = useRef(new Set());
  const chordRef = useRef({ ab: false });
  const uiRef = useRef({ visible: false, mode: 'tag' });
  const drawRef = useRef({ active: false, x: 0, y: 0, points: [], functionalHit: false });
  // Generations-Counter fuer Tile-Sync. Wird bei jedem pointerup/Reload erhoeht;
  // alte in-flight-Responses (zu kleinerer Gen) werden ignoriert.
  const tileSyncGenRef = useRef(0);
  // Abort-Controller fuer den initialen Tile-Fetch (wird beim Unmount gecancelt).
  const tilesFetchAbortRef = useRef(/** @type {AbortController | null} */ (null));

  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  useEffect(() => {
    uiRef.current = { visible: featureVisible, mode };
  }, [featureVisible, mode]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (mode !== 'erase') {
      // Beim Verlassen des Schwamm-Modus: Counter resetten und Base neu malen.
      // Sonst bleiben evtl. waehrend eines aktiven Erase-Strichs angesammelte
      // destination-out-Pixel im Base-Canvas sichtbar, obwohl der Stroke nie
      // gepostet wurde.
      eraseCommittedUpToRef.current = 0;
      baseDirtyRef.current = true;
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
    const ctrl = new AbortController();
    tilesFetchAbortRef.current = ctrl;
    let cancelled = false;
    (async () => {
      try {
        const { tiles: list } = await fetchTilesForPage(page, { signal: ctrl.signal });
        if (cancelled) return;
        const map = new Map();
        for (const t of list) map.set(`${t.x}:${t.y}`, t);
        setTiles(map);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.warn('[graffiti] Tiles laden fehlgeschlagen', err);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
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

  // Malt alle Tiles in ihrer Zielposition ins Base-Canvas. Erwartet dass ctx
  // bereits via setTransform(DPR, ...) skaliert ist — die Tile-Coords werden
  // in CSS-Pixeln angegeben, nicht physisch.
  function drawTilesOntoContext(ctx, tilesMap) {
    if (!tilesMap || tilesMap.size === 0) return;
    for (const tile of tilesMap.values()) {
      if (!tile?.image) continue;
      ctx.drawImage(tile.image, tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Schreibt einen Tag-Stroke (Polyline) permanent ins Base. Pixel-identisch zur
  // Live-Vorschau in paintComposite, damit der User keinen Sprung sieht wenn
  // pointerup den Stroke commitet.
  function commitTagStroke(ctx, points) {
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#111';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.93;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Schreibt einen Spray-Stroke permanent ins Base. seedBase verschiebt den
  // RNG-Seed pro Punkt, damit derselbe Stroke wiederholbar diesselbe Pixel-
  // verteilung produziert (Live-Vorschau verwendet dasselbe Seed-Schema).
  function commitSprayStroke(ctx, points, seedBase) {
    if (!Array.isArray(points) || points.length < 1) return;
    ctx.save();
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      drawSprayCloud(ctx, seedBase + i, p.x, p.y, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Wendet Schwamm-Punkte permanent (destination-out) auf einen Context an.
  // Wird sowohl beim inkrementellen Live-Commit als auch beim Resync (z.B. nach
  // Resize) aufgerufen. Bewusst OHNE Cursor-Outline — die Outline lebt nur im
  // Composite-Canvas und wird pro Frame neu gemalt.
  function commitErasePoints(ctx, points) {
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
  }

  // Visueller Cursor-Ring (pink, dezent) am aktuellen Schwamm-Mittelpunkt.
  // Wird nur ins Composite-Canvas gemalt und ist pro Frame ephemer.
  function drawEraseCursor(ctx, point) {
    if (!point) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(200, 70, 160, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, ERASE_RADIUS, 0, Math.PI * 2);
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
      // Tiles vom Server in ihrer Zielposition aufs Base malen.
      drawTilesOntoContext(bctx, tilesRef.current);
      // Falls gerade ein Schwamm-Stroke aktiv ist, MUSS die bisherige Spur erneut
      // ins frisch gemalte Base committeted werden — sonst wuerde sie bei einem
      // Resize / Tile-Resync mid-stroke einfach verschwinden, der User sieht
      // ploetzlich wieder alles was er gerade weggewischt hat.
      if (drawRef.current.active && modeRef.current === 'erase' && drawRef.current.points.length) {
        commitErasePoints(bctx, drawRef.current.points);
        eraseCommittedUpToRef.current = drawRef.current.points.length;
      } else {
        eraseCommittedUpToRef.current = 0;
      }
      baseDirtyRef.current = false;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, docWidth, docHeight);
    ctx.drawImage(base, 0, 0, docWidth, docHeight);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const dr = drawRef.current;
    const m = modeRef.current;

    // Live-Vorschau Tag: pixel-identisch zum spaeteren commitTagStroke.
    if (dr.active && m === 'tag') {
      commitTagStroke(ctx, dr.points);
    }

    // Live-Vorschau Spray: seedBase=0 — der spaetere finale Commit verwendet
    // dasselbe Seed-Schema, damit kein Sprung beim pointerup entsteht.
    if (dr.active && m === 'spray') {
      commitSprayStroke(ctx, dr.points, 0);
    }

    if (dr.active && m === 'erase' && dr.points.length) {
      // Inkrementeller Commit: nur die Punkte ab eraseCommittedUpToRef sind neu.
      // Bei einem typischen Move-Frame ist das genau 1 Punkt — ein einziger
      // destination-out-Arc statt n*destination-out wie vorher.
      const total = dr.points.length;
      const upTo = eraseCommittedUpToRef.current;
      if (total > upTo) {
        const newPts = dr.points.slice(upTo);
        commitErasePoints(bctx, newPts);
        eraseCommittedUpToRef.current = total;
        // Base hat sich gerade geaendert -> Composite muss neu daraus gezogen werden.
        ctx.clearRect(0, 0, docWidth, docHeight);
        ctx.drawImage(base, 0, 0, docWidth, docHeight);
      }
      // Cursor-Outline am aktuellen Punkt: lebt nur im Composite, wird pro Frame
      // neu gezeichnet — KEIN Commit ins Base. Das ist der visuelle Indikator
      // damit der User sieht "hier waere meine naechste Loesch-Region".
      drawEraseCursor(ctx, dr.points[dr.points.length - 1]);
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
  }, [tiles]);

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
          // Pointer-Capture: alle weiteren Events dieses Pointers (move/up/cancel)
          // gehen an dieses Canvas, auch wenn der Finger/Stift es geometrisch verlaesst.
          // Behebt: "Strich verschwindet sobald man uebers Canvas-Ende rauszieht".
          // Try/catch weil aeltere Safari/Webkit-Versionen unter speziellen Bedingungen werfen.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Pointer-Capture nicht verfuegbar — Stroke funktioniert trotzdem,
            // aber bricht ab wenn der Pointer das Canvas verlaesst.
          }
          // Counter fuer den inkrementellen Schwamm-Commit zuruecksetzen,
          // egal welcher Mode aktiv ist — neuer Stroke = frischer Counter.
          eraseCommittedUpToRef.current = 0;
          const pos = pointerToCanvas(e);
          drawRef.current = {
            active: true,
            x: pos.x,
            y: pos.y,
            points: [{ x: Math.round(pos.x), y: Math.round(pos.y) }],
            // Einmalig beim Down: liegt der Stroke-Start auf einem geschuetzten Element?
            // Server blockt dann Erase. Bewusst nicht im Move neu pruefen — siehe pointermove.
            functionalHit: isFunctionalAtPoint(e.clientX, e.clientY),
          };
          schedulePaint();
        }}
        onPointerMove={(e) => {
          // Hot-Path: wird pro Pointer-Frame aufgerufen (oft 60-120Hz auf Tablet).
          // Hier KEINE DOM-Layout-Abfragen wie elementFromPoint — das forciert Reflow.
          // functionalHit wurde bereits einmalig in pointerdown gesetzt; der Server-
          // seitige Schutz vor Erase auf Buttons greift weiterhin auf diesem Wert.
          if (!enabled || !drawRef.current.active) return;
          const pos = pointerToCanvas(e);
          // Punkt-Limit verhindert Endlos-Speicherwachstum bei sehr langen Strichen.
          if (drawRef.current.points.length < 420) {
            drawRef.current.points.push({ x: Math.round(pos.x), y: Math.round(pos.y) });
          }
          schedulePaint();
        }}
        onPointerUp={async () => {
          if (!drawRef.current.active) return;
          // Snapshot der Stroke-Punkte — drawRef.points wird ggf. spaeter resettet.
          const points = drawRef.current.points.slice();
          const strokeMode = modeRef.current;
          const base = baseCanvasRef.current;
          const bctx = base?.getContext('2d');

          // 1) Stroke permanent ins Base committen.
          //    Erase ist durch Phase-1 inkrementell schon committed; tag/spray
          //    werden hier final festgehalten — pixel-identisch zur Live-Vorschau,
          //    damit kein Sprung im Composite auftaucht.
          if (bctx) {
            if (strokeMode === 'tag') commitTagStroke(bctx, points);
            else if (strokeMode === 'spray') commitSprayStroke(bctx, points, 0);
          }
          drawRef.current.active = false;
          schedulePaint();

          // 2) Bestimme welche Tiles vom Stroke beruehrt wurden.
          //    getStrokeBounds enthaelt bereits Padding fuer Pinsel-/Spray-/Erase-Radius.
          const bounds = getStrokeBounds(points);
          if (!bounds || !base || !bctx) return;
          const affected = tilesCoveringBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
          if (affected.length === 0) return;

          const dpr = window.devicePixelRatio || 1;
          const pagePath = location.pathname;
          // Generation-Counter: spaetere Stroke-Uploads invalidieren in-flight Responses
          // dieses hier (z.B. wenn der User schnell mehrere Strokes hintereinander
          // macht und der erste noch nicht ge-acked ist).
          const myGen = ++tileSyncGenRef.current;

          // 3) Pro betroffenem Tile parallel: Region aus Base extrahieren und uploaden.
          const results = await Promise.all(
            affected.map(async ({ x: tx, y: ty }) => {
              try {
                const pngBase64 = await extractTilePngBase64(base, tx, ty, dpr);
                const key = `${tx}:${ty}`;
                const known = tilesRef.current.get(key);
                const baseVersion = known?.version || 0;
                const upload = await uploadTile({
                  pagePath,
                  tileX: tx,
                  tileY: ty,
                  baseVersion,
                  pngBase64,
                  strokeBounds: bounds,
                });
                return { tx, ty, pngBase64, upload };
              } catch (err) {
                return { tx, ty, error: err };
              }
            })
          );
          if (myGen !== tileSyncGenRef.current) return;

          // 4) Auswerten. Bei IRGENDEINEM Conflict / Fehler: Hard-Reload aller Tiles
          //    von der Server-Truth — der lokale Strich geht dabei verloren.
          //    Fuer Phase 2 die pragmatische Konfliktloesung; ein granulares Retry
          //    pro Tile waere praeziser, aber deutlich mehr Code.
          const anyFailure = results.some((r) => r.error || !r.upload?.ok);
          if (anyFailure) {
            try {
              const fresh = await fetchTilesForPage(pagePath);
              if (myGen !== tileSyncGenRef.current) return;
              const map = new Map();
              for (const t of fresh.tiles) map.set(`${t.x}:${t.y}`, t);
              setTiles(map);
              // baseDirty triggert Repaint aus Server-Truth -> lokale destination-out
              // / tag / spray Pixel verschwinden, Server-Stand wird sichtbar.
              baseDirtyRef.current = true;
              eraseCommittedUpToRef.current = 0;
              flushPaintComposite();
            } catch (err) {
              console.warn('[graffiti] Tile-Reload nach Fehler fehlgeschlagen', err);
            }
            return;
          }

          // 5) Alles OK: lokale tile-Map mit neuen Versionen + Images aktualisieren.
          //    Wir laden das exportierte PNG nochmal als Image-Element, damit ein
          //    spaeterer baseDirty (Resize, Mode-Wechsel) den frischen Strich
          //    wieder rendern kann statt das alte Tile-Image zu nehmen.
          const nextMap = new Map(tilesRef.current);
          await Promise.all(
            results.map(async (r) => {
              try {
                const img = await loadTileImageFromBase64(r.pngBase64);
                nextMap.set(`${r.tx}:${r.ty}`, {
                  x: r.tx,
                  y: r.ty,
                  version: r.upload.version,
                  image: img,
                });
              } catch {
                // Wenn der eigene PNG-Decode failed haben wir ein groesseres Problem,
                // aber serverseitig ist das Tile bereits gespeichert -> beim naechsten
                // Page-Load wird's korrekt geladen.
              }
            })
          );
          if (myGen !== tileSyncGenRef.current) return;
          eraseCommittedUpToRef.current = 0;
          setTiles(nextMap);
        }}
        onPointerCancel={() => {
          // Echter Abbruch: System hat das Pointer-Tracking unterbrochen
          // (z.B. iOS-Notification, eingehender Anruf, Browser-Gesture-Override).
          // Hier ist der aktuelle Strich verloren — Cleanup nicht-committeter Vorschau.
          // pointerLeave wurde absichtlich entfernt: dank setPointerCapture feuert es
          // waehrend eines Strokes nicht, und sein vorheriges Verhalten ("Stroke killen
          // wenn Finger ueber den Canvas-Rand geht") war auf Tablets nervig.
          if (!drawRef.current.active) return;
          const wasErase = modeRef.current === 'erase';
          drawRef.current.active = false;
          if (wasErase) {
            // Lokal angewandte destination-out-Pixel im Base verwerfen — Stroke
            // wurde nie an den Server geschickt, der Effekt darf nicht haengen bleiben.
            baseDirtyRef.current = true;
            eraseCommittedUpToRef.current = 0;
          } else {
            // Tag/Spray: live-Vorschau ist im Composite (nicht im Base), wird beim
            // naechsten paint nicht mehr gezeichnet weil drawRef.active=false.
            // Nichts zu tun ausser repaint.
          }
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
