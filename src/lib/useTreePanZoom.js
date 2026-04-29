/**
 * useTreePanZoom — Pan/Zoom-Hook fuer den SVG-Quest-Baum.
 *
 * Kapselt die gesamte Viewport-Interaktion:
 * - Mouse-Wheel Zoom (pinch-to-zoom auf Trackpad)
 * - Touch Pinch-to-Zoom (zwei Finger)
 * - Pointer-Drag Pan mit Threshold (5px, um Clicks nicht zu verschlucken)
 * - Zoom-Limits: 0.24x bis 2.4x
 *
 * Gibt State (pan, scale, dragging) und Event-Handler zurueck,
 * die direkt an den Viewport gebunden werden.
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

/** Ab dieser Bewegung (px) zaehlt die Geste als Pan — Klick auf Knoten bleibt erhalten. */
const PAN_DRAG_THRESHOLD_PX = 5;
const ZOOM_MIN = 0.24;
const ZOOM_MAX = 2.4;
const TRACKPAD_PAN_SPEED = 0.6;

/**
 * @param {object} opts
 * @param {boolean} opts.blockGestures — Wenn true, werden alle Viewport-Gesten ignoriert (z.B. mobiles Detail-Layout).
 * @param {boolean} opts.enabled — Erst aktiv nach Bootstrap.
 */
export function useTreePanZoom({ blockGestures = false, enabled = true }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);

  // Refs fuer stabile Closure-Werte in Event-Listenern
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragRef = useRef(
    /** @type {{ px: number; py: number; vx: number; vy: number; moved?: boolean } | null} */ (null)
  );
  /** Nach echtem Pan: naechsten Click auf Knoten ignorieren */
  const suppressClickRef = useRef(false);
  const viewportRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const pinchRef = useRef(
    /** @type {{ d0: number; s0: number; px0: number; py0: number; wx: number; wy: number } | null} */ (null)
  );
  // Refs immer synchron halten
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // Wheel + Touch-Pinch Listener (passive: false noetig fuer preventDefault)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || blockGestures) return;

    // Wheel/Trackpad:
    // - Zwei-Finger-Swipe/Scroll = Pan
    // - Zoom nur mit gedrueckter Ctrl-Taste
    const onWheel = (/** @type {WheelEvent} */ e) => {
      e.preventDefault();
      if (!enabled) return;
      const isZoomGesture = e.ctrlKey;
      if (!isZoomGesture) {
        const panC = panRef.current;
        const nextPan = {
          x: panC.x - e.deltaX * TRACKPAD_PAN_SPEED,
          y: panC.y - e.deltaY * TRACKPAD_PAN_SPEED,
        };
        setPan(nextPan);
        return;
      }
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const zoomDelta = e.deltaY;
      const factor = Math.exp(-zoomDelta * 0.0012);
      const panC = panRef.current;
      const scaleC = scaleRef.current;
      const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scaleC * factor));
      // Zoom-Pivot: Weltkoordinaten unter dem Cursor beibehalten
      const wx = (mx - panC.x) / scaleC;
      const wy = (my - panC.y) / scaleC;
      setScale(nextScale);
      setPan({ x: mx - wx * nextScale, y: my - wy * nextScale });
    };

    // Touch: Pinch-to-Zoom mit zwei Fingern
    const touchDist = (/** @type {Touch} */ a, /** @type {Touch} */ b) =>
      Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

    const onTouchStart = (/** @type {TouchEvent} */ e) => {
      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const d0 = touchDist(t0, t1);
        const mx0 = (t0.clientX + t1.clientX) / 2 - rect.left;
        const my0 = (t0.clientY + t1.clientY) / 2 - rect.top;
        pinchRef.current = {
          d0,
          s0: scaleRef.current,
          px0: panRef.current.x,
          py0: panRef.current.y,
          wx: (mx0 - panRef.current.x) / scaleRef.current,
          wy: (my0 - panRef.current.y) / scaleRef.current,
        };
      }
    };

    const onTouchMove = (/** @type {TouchEvent} */ e) => {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const p = pinchRef.current;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const d = touchDist(t0, t1);
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;
      const ratio = d / p.d0;
      const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.s0 * ratio));
      setScale(nextScale);
      setPan({ x: mx - p.wx * nextScale, y: my - p.wy * nextScale });
    };

    const onTouchEndPinch = () => { pinchRef.current = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEndPinch);
    el.addEventListener('touchcancel', onTouchEndPinch);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEndPinch);
      el.removeEventListener('touchcancel', onTouchEndPinch);
    };
  }, [blockGestures, enabled]);

  // Pointer-Drag: Pan mit Threshold
  const onPointerDownViewport = useCallback(
    (/** @type {PointerEvent} */ e) => {
      if (blockGestures) return;
      if (e.button !== 0) return;
      suppressClickRef.current = false;
      dragRef.current = { px: e.clientX, py: e.clientY, vx: pan.x, vy: pan.y, moved: false };
      setDragging(true);
      const el = viewportRef.current;
      if (el) {
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    },
    [blockGestures, pan.x, pan.y]
  );

  const onPointerMove = useCallback((/** @type {PointerEvent} */ e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) >= PAN_DRAG_THRESHOLD_PX) d.moved = true;
    setPan({ x: d.vx + dx, y: d.vy + dy });
  }, []);

  const onPointerUp = useCallback((/** @type {PointerEvent} */ e) => {
    const d = dragRef.current;
    if (d?.moved) suppressClickRef.current = true;
    dragRef.current = null;
    setDragging(false);
    const el = viewportRef.current;
    if (el) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  }, []);

  return {
    pan,
    setPan,
    scale,
    setScale,
    dragging,
    viewportRef,
    /** true wenn nach einem Pan der naechste Click unterdrueckt werden soll */
    suppressClickRef,
    // Event-Handler fuer den Viewport
    onPointerDownViewport,
    onPointerMove,
    onPointerUp,
  };
}
