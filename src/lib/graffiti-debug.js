/**
 * src/lib/graffiti-debug.js
 *
 * Leichtgewichtige Debug-Instrumentierung fuer das Graffiti-Overlay.
 * Ziel: Tablet-Flicker (Strokes flackern / verschwinden nach paar Strichen)
 * gezielt nachvollziehen, ohne die Hot-Paths spuerbar zu verteuern wenn
 * Debug aus ist.
 *
 * Aktivieren auf der Seite:
 *   __fgraffitiDebug.enable()    // persistiert via localStorage
 *   __fgraffitiDebug.disable()
 *   __fgraffitiDebug.snapshot()  // ring-buffer als Array
 *   __fgraffitiDebug.download()  // JSON-Datei ueber temporaeren <a download>
 *   __fgraffitiDebug.clear()
 *
 * Konvention: alle Events haben `tag` (kurzer String) + optional `data`.
 * Die zentralen tags:
 *   pointer-down / pointer-move-sample / pointer-up / pointer-cancel
 *   paint-start / base-rebuild
 *   tiles-effect / set-tiles
 *   upload-enqueue / upload-start / upload-tile / upload-complete
 *   commit-base
 */

const RING_SIZE = 1200;
const STATE_KEY = 'fgraffiti.debug';

let ring = [];
let runtimeEnabled = false;
let runtimeChecked = false;
let seq = 0;
const counters = {
  paints: 0,
  baseRebuilds: 0,
  setTiles: 0,
  uploadsEnqueued: 0,
  uploadsStarted: 0,
  uploadsCompleted: 0,
  uploadsFailed: 0,
  strokes: 0,
  pointerDowns: 0,
  pointerCancels: 0,
};
const hudListeners = new Set();

function readPersistedFlag() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(STATE_KEY) === '1') return true;
  } catch {
    // ignore
  }
  // URL-Schalter fuer Tablet-Nutzung ohne DevTools-Zugang:
  //   …/seite#fgraffiti-debug   → Debug an + persistiert
  //   …/seite#fgraffiti-debug-off → Debug aus + Buffer geleert
  // Hash bleibt bewusst stehen, damit ein Reload weiter im Debug-Modus startet
  // bis aktiv deaktiviert wird.
  try {
    if (typeof location !== 'undefined') {
      const hash = (location.hash || '').toLowerCase();
      if (hash.includes('fgraffiti-debug-off')) {
        try { localStorage.removeItem(STATE_KEY); } catch { /* ignore */ }
        return false;
      }
      if (hash.includes('fgraffiti-debug')) {
        try { localStorage.setItem(STATE_KEY, '1'); } catch { /* ignore */ }
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export function isEnabled() {
  if (!runtimeChecked) {
    runtimeChecked = true;
    runtimeEnabled = readPersistedFlag();
  }
  return runtimeEnabled;
}

export function dbg(tag, data) {
  if (!isEnabled()) return;
  seq += 1;
  const entry = {
    seq,
    t: typeof performance !== 'undefined' ? Math.round(performance.now()) : Date.now(),
    tag,
    data: data === undefined ? null : data,
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  // console.debug ist im Safari Web-Inspector standardmaessig aus — bewusst
  // weiter benutzen, der primaere Kanal ist der Ring-Buffer / Download.
  // eslint-disable-next-line no-console
  console.debug(`[fgraffiti] ${tag}`, data ?? '');
  for (const fn of hudListeners) {
    try { fn(entry); } catch { /* ignore */ }
  }
}

export function bumpCounter(name, by = 1) {
  if (!isEnabled()) return;
  if (Object.prototype.hasOwnProperty.call(counters, name)) {
    counters[name] += by;
  }
}

export function getCounters() {
  return { ...counters };
}

export function subscribeHud(fn) {
  hudListeners.add(fn);
  return () => hudListeners.delete(fn);
}

export function snapshot() {
  return ring.slice();
}

export function clear() {
  ring = [];
  seq = 0;
  for (const k of Object.keys(counters)) counters[k] = 0;
  for (const fn of hudListeners) {
    try { fn(null); } catch { /* ignore */ }
  }
}

export function enable() {
  runtimeEnabled = true;
  runtimeChecked = true;
  try { localStorage.setItem(STATE_KEY, '1'); } catch { /* ignore */ }
  // eslint-disable-next-line no-console
  console.info('[fgraffiti] debug enabled — reload empfohlen, damit die instrumentierten Code-Pfade greifen wenn der Layer schon mounted ist.');
}

export function disable() {
  runtimeEnabled = false;
  runtimeChecked = true;
  try { localStorage.removeItem(STATE_KEY); } catch { /* ignore */ }
  clear();
}

export function download() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const payload = {
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    counters: getCounters(),
    events: ring,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fgraffiti-debug-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

if (typeof window !== 'undefined') {
  // Single API-Surface fuer manuelle Inspektion via Web-Inspector / Bookmarklet.
  window.__fgraffitiDebug = Object.freeze({
    enable,
    disable,
    snapshot,
    clear,
    download,
    isEnabled,
    counters: getCounters,
  });
}
