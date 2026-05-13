/**
 * SiteInventory — Hand-Inventar mit Halbkreis-UI unten links.
 *
 * Ausklappbarer Fächer mit 6 Slots oberhalb des Halbkreises. Der Hand-Slot
 * ist separat: wenn belegt, folgt das Item dem Cursor und ein Drop-Overlay
 * fängt alle Page-Klicks ab → POST drop.
 *
 * Long-Press auf das Overlay (>= LONG_PRESS_MS gedrückt halten) emittiert
 * ein `site-tool-use`-CustomEvent, das z.B. der GraffitiLayer abfängt um
 * sich mit dem Hand-Item als Werkzeug zu aktivieren.
 *
 * Nicht eingeloggte User sehen das Inventar nicht (GET /me → 401).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { enqueueInventoryOp } from '../lib/site-inventory-queue.js';

const SLOT_KEYS = ['slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
const LONG_PRESS_MS = 280;
const DRAG_THRESHOLD_PX = 6;
/** Maximaler Abstand zwischen zwei Taps, damit sie als Doppel-Tap zählen. */
const DOUBLE_TAP_MS = 350;

/** Emoji-Lookup analog GraffitiLayer.iconForItem — bewusst dupliziert, kein Coupling. */
function iconForItem(item) {
  if (!item) return '•';
  const sm = item.config?.strokeMode;
  if (sm === 'erase') return '🧽';
  if (sm === 'spray') return '🧯';
  if (item.kind === 'stamp') return '🪧';
  if (item.kind === 'sticker') return '🏷️';
  if (item.kind === 'key') return '🔑';
  if (item.kind === 'pen') return '✎';
  return '📦';
}

/**
 * Slot-Position um den Halbkreis. Fächer von links (i=0) nach rechts (i=N-1)
 * über die obere Hemisphäre. Werte in rem relativ zum Container-Boden + 50%-X.
 */
function slotPosition(index, count) {
  const containerCenterX = 6; // halb von 12rem container
  const halfTop = 1.85;       // knapp über der Halbkreis-Höhe (1.75rem)
  const slotRadius = 3.2;     // näher am Halbkreis (vorher 4.8)
  const slotSize = 1.6;
  const angleDeg = 180 - (count <= 1 ? 90 : (index / (count - 1)) * 180);
  const angleRad = (angleDeg * Math.PI) / 180;
  const xOff = Math.cos(angleRad) * slotRadius;
  const yOff = Math.sin(angleRad) * slotRadius;
  return {
    left: `calc(${containerCenterX + xOff}rem - ${slotSize / 2}rem)`,
    bottom: `calc(${halfTop + yOff}rem - ${slotSize / 2}rem)`,
  };
}

export default function SiteInventory() {
  const [inventory, setInventory] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0, visible: false });

  // Long-press-State: gesetzt im pointerdown auf Drop-Overlay. isTouch und
  // isDoubleTap entscheiden auf pointerup, ob ein Tap-Up zum Drop wird oder
  // erstmal als First-Tap gemerkt wird (für die Doppel-Tap-Erkennung).
  const pressRef = useRef(
    /** @type {null | { startX: number, startY: number, timer: number, fired: boolean, isTouch: boolean, isDoubleTap: boolean }} */ (null)
  );
  /** Zeitstempel des letzten Touch-Tap-Ups, für Doppel-Tap-Erkennung. */
  const lastTapAtRef = useRef(0);
  /** Verhindert dass zwei schnell aufeinanderfolgende Drop-Events (z.B. zwei
   *  Canvas-Klicks deren Listener noch denselben handItem-Closure sehen) zwei
   *  Items absetzen. Wird auf true gesetzt während dropAtPoint läuft. */
  const dropInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/site-inventory/me', { credentials: 'same-origin' });
        if (res.status === 401) {
          if (!cancelled) setLoaded(true);
          return;
        }
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setInventory(data.inventory || null);
        setLoaded(true);
      } catch (err) {
        console.warn('[site-inventory] load failed', err);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Externe Updates: 'update' = volles Inventar (Server-Truth nach Roundtrip),
  // 'patch' = partial-merge für optimistische Updates (sofortige UI-Reaktion
  // bevor der Server antwortet).
  useEffect(() => {
    function onUpdate(e) {
      const inv = e?.detail?.inventory;
      if (inv && typeof inv === 'object') setInventory(inv);
    }
    function onPatch(e) {
      const patch = e?.detail?.patch;
      if (!patch || typeof patch !== 'object') return;
      setInventory((prev) => (prev ? { ...prev, ...patch } : prev));
    }
    window.addEventListener('site-inventory-update', onUpdate);
    window.addEventListener('site-inventory-patch', onPatch);
    return () => {
      window.removeEventListener('site-inventory-update', onUpdate);
      window.removeEventListener('site-inventory-patch', onPatch);
    };
  }, []);

  const handItem = inventory?.hand || null;

  // Cursor-Follower: nur aktiv wenn Hand belegt.
  useEffect(() => {
    if (!handItem) {
      setCursorPos((p) => (p.visible ? { ...p, visible: false } : p));
      return undefined;
    }
    function onMove(e) {
      setCursorPos({ x: e.clientX, y: e.clientY, visible: true });
    }
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [handItem]);

  // Body-Class toggeln: macht den OS-Cursor seitenweit unsichtbar wenn die
  // Hand belegt ist — der Follower-Span tritt visuell an seine Stelle.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (handItem) {
      document.body.classList.add('site-holding-item');
    } else {
      document.body.classList.remove('site-holding-item');
    }
    return () => {
      document.body.classList.remove('site-holding-item');
    };
  }, [handItem]);

  // Hand belegt mit draw-Tool → GraffitiLayer sofort aktivieren, ohne Long-
  // Press. Beim Wechsel zu leerer Hand (oder Non-Draw) wird der Tool-Mode
  // explizit beendet. Damit ist "Item in der Hand" === "Tool aktiv" —
  // ein einziger State statt zwei sich beißender.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (handItem && handItem.behavior === 'draw') {
      window.dispatchEvent(
        new CustomEvent('site-tool-use', { detail: { item: handItem } })
      );
    } else {
      window.dispatchEvent(new CustomEvent('site-tool-deactivate'));
    }
  }, [handItem?.id, handItem?.behavior]);

  // GraffitiLayer ruft Drop an wenn der User mit dem aktiven Tool nur klickt
  // ohne zu malen (PC: Linksklick, Mobile: Doppel-Tap). Wir machen daraus
  // ein ganz normales dropAtPoint im aktuellen pagePath.
  useEffect(() => {
    function onDropRequest(e) {
      const { x, y } = e?.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (!handItem) return;
      void dropAtPoint(x, y);
    }
    window.addEventListener('site-inventory-request-drop', onDropRequest);
    return () => window.removeEventListener('site-inventory-request-drop', onDropRequest);
    // dropAtPoint Closure liest handItem live — deps reichen leer.
  }, [handItem]);

  /**
   * Schickt eine Inventar-Mutation an den Server. WIRD durch enqueueInventoryOp
   * von außen serialisiert, damit pickup/drop/swap nicht parallel laufen und
   * Server-State-Races (z.B. Drop sieht hand=null weil Pickup noch nicht
   * durch ist → 409) ausgeschlossen sind.
   */
  async function postAction(body) {
    try {
      const res = await fetch('/api/site-inventory/me', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[site-inventory] action failed', body, data);
        return null;
      }
      // Bewusst KEIN setInventory(data.inventory) bei Erfolg — alle Caller
      // machen optimistic-UI, und der späte Server-Stand würde sonst eine
      // jüngere optimistic-Änderung wieder überschreiben.
      return data;
    } catch (err) {
      console.warn('[site-inventory] action error', body, err);
      return null;
    }
  }

  function handleSlotClick(slotKey) {
    if (!inventory) return;
    const prevHand = inventory.hand || null;
    const prevSlot = inventory[slotKey] || null;
    if (!prevHand && !prevSlot) return; // beide leer → nichts zu tun
    // Optimistisch hand ↔ slot tauschen, damit der User sofort sieht wie das
    // Item rauswandert. Server-Call durch die Inventar-Queue (kein Konflikt
    // mit gleichzeitigem pickup/drop). Rollback bei Fehler.
    setInventory((prev) =>
      prev ? { ...prev, hand: prevSlot, [slotKey]: prevHand } : prev
    );
    void enqueueInventoryOp(async () => {
      const data = await postAction({ action: 'swap', from: 'hand', to: slotKey });
      if (!data) {
        setInventory((prev) =>
          prev ? { ...prev, hand: prevHand, [slotKey]: prevSlot } : prev
        );
      }
    });
  }

  function clearLongPress() {
    if (pressRef.current?.timer) {
      window.clearTimeout(pressRef.current.timer);
    }
    pressRef.current = null;
  }

  function dropAtPoint(pageX, pageY) {
    // Synchroner Doppel-Drop-Schutz: wenn die optimistische Phase schon
    // läuft (Hand grad geleert + temp-Add dispatched), ignoriere weitere
    // Aufrufe bis sie verarbeitet sind. Schützt vor zwei rapid pointer-ups.
    if (dropInFlightRef.current) return;
    const dropped = handItem;
    if (!dropped) return;
    dropInFlightRef.current = true;
    const pagePath = typeof location !== 'undefined' ? location.pathname : '/';
    // Temp-ID: negativ damit klar von echten Server-IDs (positiv) unterscheidbar.
    const tempId = -Date.now() - Math.floor(Math.random() * 1000);

    // Optimistisch: Hand leeren + placed-item sofort an die Drop-Position legen.
    setInventory((prev) => (prev ? { ...prev, hand: null } : prev));
    window.dispatchEvent(
      new CustomEvent('site-placed-items-add', {
        detail: {
          item: {
            placedItemId: tempId,
            x: pageX,
            y: pageY,
            placedBy: 'me',
            placedAt: '',
            item: dropped,
          },
        },
      })
    );

    // Server-Call durch die Inventar-Queue — pickup/drop/swap laufen
    // serialisiert, niemals parallel. Damit kann kein Drop server-seitig
    // einen noch nicht durchgelaufenen Pickup sehen ("hand=null → 409").
    void enqueueInventoryOp(async () => {
      try {
        const data = await postAction({ action: 'drop', pagePath, x: pageX, y: pageY });
        if (data?.placedItemId) {
          // Temp-ID gegen Server-ID austauschen, damit das frisch gedropte
          // Item wieder aufhebbar ist (sonst 404 wegen Temp-ID).
          window.dispatchEvent(
            new CustomEvent('site-placed-items-replace-id', {
              detail: { tempId, realId: data.placedItemId },
            })
          );
        } else {
          // Server-Fehler → Rollback: Item zurück in Hand, optimistic-placed weg.
          setInventory((prev) => (prev ? { ...prev, hand: dropped } : prev));
          window.dispatchEvent(
            new CustomEvent('site-placed-items-remove', { detail: { placedItemId: tempId } })
          );
        }
      } finally {
        dropInFlightRef.current = false;
      }
    });
  }

  function onOverlayPointerDown(e) {
    if (!handItem) return;
    if (e.target !== e.currentTarget) return;
    const isTouch = e.pointerType === 'touch';
    // PC: nur Linksmaustaste (button=0) triggert Drop-Logik. Rechts/Mittel
    // sollen das Browser-Default-Verhalten (z.B. Kontextmenü) behalten.
    if (!isTouch && e.button !== 0) return;
    const startX = e.pageX;
    const startY = e.pageY;
    // Doppel-Tap nur auf Touch: zweiter Tap innerhalb DOUBLE_TAP_MS = Drop.
    const isDoubleTap = isTouch && Date.now() - lastTapAtRef.current < DOUBLE_TAP_MS;
    // Long-press-Timer (plattformunabhängig): feuert → Use-Event,
    // ein nachfolgender pointerup macht KEIN Drop mehr.
    const timer = window.setTimeout(() => {
      const p = pressRef.current;
      if (!p) return;
      p.fired = true;
      window.dispatchEvent(
        new CustomEvent('site-tool-use', {
          detail: { item: handItem, x: startX, y: startY },
        })
      );
    }, LONG_PRESS_MS);
    pressRef.current = { startX, startY, timer, fired: false, isTouch, isDoubleTap };
  }

  function onOverlayPointerMove(e) {
    const p = pressRef.current;
    if (!p) return;
    const dx = e.pageX - p.startX;
    const dy = e.pageY - p.startY;
    if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      clearLongPress();
    }
  }

  function onOverlayPointerUp(e) {
    const p = pressRef.current;
    if (!p) return;
    const wasUse = p.fired;
    const isTouch = p.isTouch;
    const isDoubleTap = p.isDoubleTap;
    clearLongPress();
    if (wasUse) return; // Long-press → Use bereits emittiert, kein Drop

    if (isTouch) {
      // Touch-Semantik: Drop NUR bei Doppel-Tap. Single-Tap ist nur "erster
      // Tap" und wird gemerkt; der nächste Tap innerhalb DOUBLE_TAP_MS dropt.
      if (isDoubleTap) {
        lastTapAtRef.current = 0;
        void dropAtPoint(e.pageX, e.pageY);
      } else {
        lastTapAtRef.current = Date.now();
      }
    } else {
      // PC: Single Linksklick (bereits in pointerdown gefiltert) → Drop.
      void dropAtPoint(e.pageX, e.pageY);
    }
  }

  if (!loaded || !inventory) return null;

  return (
    <>
      {/* Drop-Overlay nur noch für Non-Draw-Items. Bei draw-Tools übernimmt
          GraffitiLayer das Canvas und meldet Drop-Wünsche via Custom-Event
          (site-inventory-request-drop), sodass es keinen Pointer-Konflikt
          zwischen Overlay und Mal-Canvas mehr gibt. */}
      {handItem && handItem.behavior !== 'draw' && (
        <div
          class="site-inventory-drop-overlay"
          onPointerDown={onOverlayPointerDown}
          onPointerMove={onOverlayPointerMove}
          onPointerUp={onOverlayPointerUp}
          onPointerCancel={clearLongPress}
          aria-hidden="true"
        />
      )}
      <div class={`site-inventory ${open ? 'is-open' : ''}`}>
        <button
          type="button"
          class={`site-inventory-half ${open ? 'is-open' : ''} ${handItem ? 'has-item' : ''}`}
          aria-label={open ? 'Hand-Inventar schließen' : 'Hand-Inventar öffnen'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {/* Aktiv-Indikator: fetter schwarzer Punkt sitzt mittig auf der
              oberen Halbkreis-Kante — overflow:hidden cuttet die obere
              Hälfte ab, also sieht man nur die untere Halbkugel. */}
          {open && <span class="site-inventory-half-active" aria-hidden="true" />}
          {!open && handItem && (
            <span class="site-inventory-half-peek" aria-hidden="true">
              {iconForItem(handItem)}
            </span>
          )}
        </button>
        {open &&
          SLOT_KEYS.map((slotKey, i) => {
            const pos = slotPosition(i, SLOT_KEYS.length);
            const item = inventory[slotKey];
            return (
              <button
                key={slotKey}
                type="button"
                class={`site-inventory-slot ${item ? 'has-item' : ''}`}
                style={{ left: pos.left, bottom: pos.bottom }}
                aria-label={item ? `Slot ${i + 1}: ${item.name}` : `Slot ${i + 1} (leer)`}
                onClick={() => handleSlotClick(slotKey)}
              >
                <span aria-hidden="true">{item ? iconForItem(item) : ''}</span>
              </button>
            );
          })}
      </div>
      {cursorPos.visible && handItem && (
        <div
          class="site-inventory-cursor"
          style={{ left: `${cursorPos.x}px`, top: `${cursorPos.y}px` }}
          aria-hidden="true"
        >
          {iconForItem(handItem)}
        </div>
      )}
      <style>{`
        .site-inventory {
          position: fixed;
          left: 0.35rem;
          bottom: 0;
          width: 12rem;
          height: 7rem;
          z-index: 397;
          pointer-events: none;
        }
        .site-inventory-half {
          position: absolute;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: 3.5rem;
          height: 1.75rem;
          padding: 0;
          margin: 0;
          border-radius: 1.75rem 1.75rem 0 0;
          background: #ffffff;
          border: 3px solid #000;
          border-bottom: none;
          cursor: pointer;
          pointer-events: auto;
          font-size: 1.1rem;
          line-height: 1;
          color: #000;
          /* overflow:hidden cuttet die obere Hälfte des aktiv-Punkts ab,
             damit man visuell nur den unteren Halbmond auf der Kante sieht. */
          overflow: hidden;
        }
        .site-inventory-half.is-open {
          background: #ffffff;
        }
        .site-inventory-half-active {
          position: absolute;
          left: 50%;
          top: 0;
          transform: translate(-50%, -50%);
          width: 1.4rem;
          height: 1.4rem;
          border-radius: 50%;
          background: #000;
          pointer-events: none;
        }
        .site-inventory-half-peek {
          position: absolute;
          left: 50%;
          bottom: 0.25rem;
          transform: translateX(-50%);
          font-size: 1rem;
        }
        .site-inventory-slot {
          position: absolute;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          background: rgba(255,255,255,0.88);
          border: 1px solid rgba(0,0,0,0.35);
          padding: 0;
          margin: 0;
          cursor: pointer;
          pointer-events: auto;
          font-size: 0.85rem;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #333;
        }
        .site-inventory-slot.has-item {
          background: rgba(255, 240, 200, 0.95);
        }
        .site-inventory-cursor {
          position: fixed;
          pointer-events: none;
          z-index: 500;
          /* Spitze des "cursor"-Icons sitzt genau am Maus-Punkt:
             leichter Offset nach oben/links, damit das Emoji-Glyph
             den Hotspot kompensiert. */
          transform: translate(-25%, -20%);
          font-size: 1.8rem;
          line-height: 1;
          text-shadow: 0 0 4px rgba(255,255,255,0.8);
        }
        .site-inventory-drop-overlay {
          position: fixed;
          inset: 0;
          z-index: 395;
          pointer-events: auto;
          background: transparent;
          /* touch-action: none verhindert dass iOS/Android ein Doppel-Tap
             als Browser-Zoom interpretiert, und unterdrückt Scroll-Gesten
             auf dem Overlay (Hand-Besitz ist exklusiver Modus). */
          touch-action: none;
        }
        /* Hand belegt → OS-Cursor überall unsichtbar, der Follower-Span
           zeigt stattdessen das Item-Icon. Greift auf body via .holding-item-
           Klasse, die wir in einem Effect togglen. !important überschreibt
           lokale cursor: pointer / crosshair / cell von Buttons & Canvas. */
        body.site-holding-item,
        body.site-holding-item * {
          cursor: none !important;
        }
        /* Während Hand belegt: Text-Selektion deaktivieren, sonst flackert
           der Browser zwischen "ich klicke ein Tool an" und "ich markiere
           Text auf der Seite" (sichtbar als blauer Selection-Highlight). */
        body.site-holding-item {
          user-select: none;
          -webkit-user-select: none;
        }
      `}</style>
    </>
  );
}
