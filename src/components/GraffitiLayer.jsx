import { useEffect, useRef, useState } from 'preact/hooks';
import {
  TILE_SIZE,
  tilesCoveringBounds,
  fetchTilesForPage,
  extractTilePngBase64,
  uploadTile,
  getStrokeBounds,
  loadTileImageFromBase64,
} from '../lib/graffiti-client.js';
import { enqueueTileUpload } from '../lib/graffiti-upload-queue.js';

/** Schwamm-Radius in CSS-Pixeln. Muss konsistent mit Server-/Tile-Render-Logik sein. */
const ERASE_RADIUS = 26;
/** Bounding-Box-Schwelle (CSS-Pixel) ab der ein pointerdown→up als Drag und
 *  nicht als Klick zählt. Drag → Stroke committen, Klick → Drop-Request. */
const DRAG_BBOX_PX = 6;
/** Maximaler Abstand zweier Taps für Doppel-Tap-Erkennung auf dem Canvas. */
const CANVAS_DOUBLE_TAP_MS = 350;

function strokeBboxIsDrag(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX - minX > DRAG_BBOX_PX || maxY - minY > DRAG_BBOX_PX;
}

/**
 * Fallback-Werkzeuge falls /api/site-items/active nicht erreichbar ist.
 * Spiegelt den Seed-Stand: Marker → Spraydose → Schwamm. Wird verworfen
 * sobald der Server-Katalog geladen ist.
 */
const FALLBACK_DRAW_ITEMS = [
  { id: 'marker_black', kind: 'pen', name: 'Marker', config: { strokeMode: 'tag', color: '#111111' } },
  { id: 'spray_black', kind: 'graffiti', name: 'Spraydose', config: { strokeMode: 'spray', color: '#101010' } },
  { id: 'sponge_eraser', kind: 'eraser', name: 'Schwamm', config: { strokeMode: 'erase' } },
];

/** Icon-Mapping basierend auf strokeMode/kind. Erweitern wenn neue Tool-Typen dazukommen. */
function iconForItem(item) {
  if (!item) return '✎';
  const m = item.config?.strokeMode;
  if (m === 'erase') return '🧽';
  if (m === 'spray') return '🧯';
  if (item.kind === 'stamp') return '🪧';
  if (item.kind === 'sticker') return '🏷️';
  return '✎';
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
  const [enabled, setEnabled] = useState(false);
  // Draw-Werkzeuge aus /api/site-items/active. Bis das Fetch durchläuft
  // (oder wenn es fehlschlägt) liefert FALLBACK_DRAW_ITEMS die alte Trias.
  const [drawItems, setDrawItems] = useState(FALLBACK_DRAW_ITEMS);
  const [selectedItemId, setSelectedItemId] = useState(FALLBACK_DRAW_ITEMS[0].id);
  const drawItemsRef = useRef(drawItems);
  const selectedItemIdRef = useRef(selectedItemId);
  // mode = aktueller strokeMode des selektierten Items, gespiegelt aus
  // selectedItem.config.strokeMode. Bleibt als getrennter State, damit
  // bestehende Render-Pfade (paintComposite etc.) ohne Item-Lookup auskommen.
  const [mode, setMode] = useState(FALLBACK_DRAW_ITEMS[0].config.strokeMode);
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
  const drawRef = useRef({ active: false, x: 0, y: 0, points: [], functionalHit: false });
  /** Letzter Tap-Up-Zeitpunkt für Doppel-Tap-Drop auf Mobile. */
  const lastTapAtRef = useRef(0);
  // Abort-Controller fuer den initialen Tile-Fetch (wird beim Unmount gecancelt).
  const tilesFetchAbortRef = useRef(/** @type {AbortController | null} */ (null));

  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  useEffect(() => {
    drawItemsRef.current = drawItems;
  }, [drawItems]);

  // Selektion-Spiegel: hält selectedItemIdRef + abgeleiteten strokeMode aktuell.
  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
    const item = drawItems.find((i) => i.id === selectedItemId);
    const next = String(item?.config?.strokeMode || 'tag');
    setMode(next);
  }, [selectedItemId, drawItems]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    // Beim Verlassen des Schwamm-Modus den incremental-counter zurücksetzen.
    // KEIN baseDirty=true hier — sonst wird das Base aus tilesRef rebuilt
    // bevor der Erase-Upload durchgekommen ist, und der User sieht kurz die
    // un-erased Version flackern. Aktive nicht-comittete Pixel werden
    // ohnehin von pointercancel/pointerup sauber abgeräumt.
    if (mode !== 'erase') {
      eraseCommittedUpToRef.current = 0;
    }
  }, [mode]);


  // SiteInventory schaltet bei jedem Hand-Wechsel den Modus für uns:
  // - 'site-tool-use' (Hand belegt mit draw-Item) → enable + Tool auswählen.
  //   Kein Long-Press mehr nötig — "in der Hand" === "aktives Werkzeug".
  // - 'site-tool-deactivate' (Hand leer oder Non-Draw-Item) → enable raus.
  useEffect(() => {
    function onSiteToolUse(e) {
      const item = e?.detail?.item;
      if (!item || item.behavior !== 'draw') return;
      const items = drawItemsRef.current;
      if (!items.some((i) => i.id === item.id)) return;
      setSelectedItemId(item.id);
      setEnabled(true);
    }
    function onSiteToolDeactivate() {
      setEnabled(false);
    }
    window.addEventListener('site-tool-use', onSiteToolUse);
    window.addEventListener('site-tool-deactivate', onSiteToolDeactivate);
    return () => {
      window.removeEventListener('site-tool-use', onSiteToolUse);
      window.removeEventListener('site-tool-deactivate', onSiteToolDeactivate);
    };
  }, []);

  // Werkzeug-Katalog vom Server laden (behavior=draw). Fehler/leer → Fallback bleibt.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/site-items/active?behavior=draw', {
          credentials: 'same-origin',
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const usable = items.filter(
          (it) => it && typeof it.id === 'string' && it.config && typeof it.config.strokeMode === 'string'
        );
        if (usable.length === 0) return;
        setDrawItems(usable);
        // Vorherige Selektion erhalten wenn möglich, sonst Index 0.
        setSelectedItemId((prev) => (usable.some((i) => i.id === prev) ? prev : usable[0].id));
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn('[graffiti] Werkzeug-Katalog laden fehlgeschlagen', err);
        }
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
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
        // Synchron + State, damit alles aus dem gleichen Map liest.
        tilesRef.current = map;
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

  /** Aktuelles Item-Objekt; Fallback wenn die Selektion ins Leere zeigt. */
  function currentDrawItem() {
    const items = drawItemsRef.current;
    return items.find((i) => i.id === selectedItemIdRef.current) || items[0] || null;
  }

  function currentColor(fallback) {
    const c = currentDrawItem()?.config?.color;
    return typeof c === 'string' && c ? c : fallback;
  }

  // Schreibt einen Tag-Stroke (Polyline) permanent ins Base. Pixel-identisch zur
  // Live-Vorschau in paintComposite, damit der User keinen Sprung sieht wenn
  // pointerup den Stroke commitet.
  function commitTagStroke(ctx, points, color) {
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color || '#111';
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
  function commitSprayStroke(ctx, points, seedBase, color) {
    if (!Array.isArray(points) || points.length < 1) return;
    ctx.save();
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      drawSprayCloud(ctx, seedBase + i, p.x, p.y, 1, color);
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

    const dr = drawRef.current;
    const m = modeRef.current;

    // ─── Base-Canvas aktualisieren BEVOR wir komponieren ──────────────────
    // Bewusste Konvention: ein einzelner Tap (points.length === 1) wird NICHT
    // committed — sonst muesste der no-drag-pointerup-Pfad mit baseDirty=true
    // wieder rueckgaengig machen, und das wiederum baut base aus tilesRef neu
    // auf, was bei noch-laufenden Uploads zu stale Tiles fuehrt (Flicker beim
    // Sponge-Drop). Erst ab dem ersten pointermove (length > 1) gilt's als Drag.
    if (baseDirtyRef.current) {
      bctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      bctx.clearRect(0, 0, docWidth, docHeight);
      drawTilesOntoContext(bctx, tilesRef.current);
      if (dr.active && m === 'erase' && dr.points.length > 1) {
        commitErasePoints(bctx, dr.points);
        eraseCommittedUpToRef.current = dr.points.length;
      } else {
        eraseCommittedUpToRef.current = 0;
      }
      baseDirtyRef.current = false;
    } else if (dr.active && m === 'erase' && dr.points.length > 1) {
      // Inkrementeller Schwamm-Commit auf das (bereits aktuelle) Base.
      const total = dr.points.length;
      const upTo = eraseCommittedUpToRef.current;
      if (total > upTo) {
        commitErasePoints(bctx, dr.points.slice(upTo));
        eraseCommittedUpToRef.current = total;
      }
    }

    // ─── Composite-Canvas neu zusammensetzen — EINE drawImage pro Frame ──
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, docWidth, docHeight);
    ctx.drawImage(base, 0, 0, docWidth, docHeight);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Live-Vorschau Tag: pixel-identisch zum spaeteren commitTagStroke.
    if (dr.active && m === 'tag') {
      commitTagStroke(ctx, dr.points, currentColor('#111'));
    }
    // Live-Vorschau Spray: seedBase=0 — der spaetere finale Commit verwendet
    // dasselbe Seed-Schema, damit kein Sprung beim pointerup entsteht.
    if (dr.active && m === 'spray') {
      commitSprayStroke(ctx, dr.points, 0, currentColor('#101010'));
    }
    // Cursor-Outline beim Schwamm — nur im Composite, pro Frame neu.
    if (dr.active && m === 'erase' && dr.points.length) {
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

  function drawSprayCloud(ctx, strokeId, x, y, alpha, color) {
    const random = seededRng((strokeId * 1315423911 + x * 31 + y * 17) | 0);
    ctx.fillStyle = color || '#101010';
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
        onPointerUp={async (e) => {
          if (!drawRef.current.active) return;
          // Snapshot der Stroke-Punkte — drawRef.points wird ggf. spaeter resettet.
          const points = drawRef.current.points.slice();
          const strokeMode = modeRef.current;
          const base = baseCanvasRef.current;
          const bctx = base?.getContext('2d');

          // Drag-vs-Klick-Erkennung: ein kurzer Klick ohne Bewegung ist KEIN
          // Stroke, sondern eine Drop-Geste (Item aus der Hand legen).
          // - PC: Linksklick ohne Drag → Drop
          // - Mobile: Doppel-Tap ohne Drag → Drop; einzelner Tap = nichts
          //   (wird als erster Tap einer möglichen Doppel-Tap-Sequenz vermerkt)
          if (!strokeBboxIsDrag(points)) {
            drawRef.current.active = false;
            // Counter zurücksetzen (Punkt wurde nicht commited, weil
            // paintComposite single-taps explizit ueberspringt). KEIN
            // baseDirty=true — sonst wuerde base aus tilesRef neu gebaut,
            // und falls der vorige Erase-Upload noch laeuft, blitzt kurz
            // die un-erased Version durch (genau der Sponge-Drop-Flicker).
            if (strokeMode === 'erase') {
              eraseCommittedUpToRef.current = 0;
            }
            schedulePaint();

            const isTouch = e.pointerType === 'touch';
            if (isTouch) {
              const isDoubleTap = Date.now() - lastTapAtRef.current < CANVAS_DOUBLE_TAP_MS;
              if (isDoubleTap) {
                lastTapAtRef.current = 0;
                window.dispatchEvent(
                  new CustomEvent('site-inventory-request-drop', {
                    detail: { x: e.pageX, y: e.pageY },
                  })
                );
              } else {
                lastTapAtRef.current = Date.now();
              }
            } else {
              window.dispatchEvent(
                new CustomEvent('site-inventory-request-drop', {
                  detail: { x: e.pageX, y: e.pageY },
                })
              );
            }
            return;
          }

          // 1) Stroke permanent ins Base committen.
          //    Erase ist durch Phase-1 inkrementell schon committed; tag/spray
          //    werden hier final festgehalten — pixel-identisch zur Live-Vorschau,
          //    damit kein Sprung im Composite auftaucht.
          if (bctx) {
            if (strokeMode === 'tag') commitTagStroke(bctx, points, currentColor('#111'));
            else if (strokeMode === 'spray') commitSprayStroke(bctx, points, 0, currentColor('#101010'));
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

          // 3) Upload-Batch durch die SERIELLE Queue. Ein zweiter Stroke wartet
          //    auf die Acks dieses hier — die `version` im tilesRef ist dann
          //    aktuell, kein 409-Race.
          void enqueueTileUpload(async () => {
            // Pro betroffenem Tile: Region aus Base extrahieren + uploaden.
            // Bei 409 (Conflict): einmal retryen mit der vom Server zurück-
            // gemeldeten currentVersion. Die Base hat die User-Erase noch
            // drin (wir clobbern sie NICHT mit fetchTilesForPage).
            const results = await Promise.all(
              affected.map(async ({ x: tx, y: ty }) => {
                try {
                  const pngBase64 = await extractTilePngBase64(base, tx, ty, dpr);
                  const key = `${tx}:${ty}`;
                  const known = tilesRef.current.get(key);
                  const baseVersion = known?.version || 0;
                  let upload = await uploadTile({
                    pagePath, tileX: tx, tileY: ty, baseVersion, pngBase64, strokeBounds: bounds,
                  });
                  if (!upload.ok && upload.conflict && typeof upload.currentVersion === 'number') {
                    // Server hat schon eine neuere Version (z.B. Mehrbenutzer).
                    // Re-Upload mit currentVersion — das aktuelle Base-PNG enthält
                    // ja eh die ganze User-Erase, also kein Datenverlust.
                    upload = await uploadTile({
                      pagePath, tileX: tx, tileY: ty,
                      baseVersion: upload.currentVersion,
                      pngBase64, strokeBounds: bounds,
                    });
                  }
                  return { tx, ty, pngBase64, upload };
                } catch (err) {
                  return { tx, ty, error: err };
                }
              })
            );

            // 4) Lokale Tile-Map mit erfolgreich uploadeten Tiles updaten.
            //    Fehlgeschlagene Tiles lassen wir in Ruhe — kein Hard-Reload mehr,
            //    sonst geht die lokale Erase wieder verloren. Die nächste
            //    erfolgreiche Operation auf demselben Tile wird's wieder
            //    konsistent ziehen.
            const successful = results.filter((r) => !r.error && r.upload?.ok);
            if (successful.length === 0) {
              console.warn('[graffiti] alle Tile-Uploads fehlgeschlagen', results);
              return;
            }
            const nextMap = new Map(tilesRef.current);
            await Promise.all(
              successful.map(async (r) => {
                try {
                  const img = await loadTileImageFromBase64(r.pngBase64);
                  nextMap.set(`${r.tx}:${r.ty}`, {
                    x: r.tx,
                    y: r.ty,
                    version: r.upload.version,
                    image: img,
                  });
                } catch {
                  // PNG-Decode failed — Server hat trotzdem die Daten, beim
                  // nächsten Page-Load wird's korrekt geladen.
                }
              })
            );
            // tilesRef SYNCHRON aktualisieren, damit der nächste Queue-Task
            // in seinem Microtask die frische Map sieht. Der useEffect mit
            // [tiles]-Dep läuft erst nach React's Commit-Phase — bis dahin
            // sähen Folge-Tasks alte Daten und würden Stroke N's neue Tile
            // beim Bauen ihres nextMap aus tilesRef wegwerfen.
            tilesRef.current = nextMap;
            setTiles(nextMap);
          });
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
      `}</style>
    </>
  );
}
