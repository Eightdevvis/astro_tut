// Sichtbarer Debug-Log fuer das Archaea-Mini-Game.
//
// Module-level Event-Buffer + Listener-Set, damit MoleculeBuilderCanvas und
// ArchaeaLipidsGame in dasselbe Log schreiben, ohne sich Props durchzureichen.
// Der Overlay-Panel-Komponentencode lebt in `MikrobioDebugPanel.jsx`.
//
// Stop-Knopf: `?nodbg=1` im URL oder localStorage `mikrobio:debug=off`.

export const MIKROBIO_DBG_EVENTS = [];
const LISTENERS = new Set();

export function dbg(label, data) {
  const entry = {
    t:
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now(),
    label,
    data: data === undefined ? null : data,
  };
  MIKROBIO_DBG_EVENTS.push(entry);
  try {
    // eslint-disable-next-line no-console
    console.log(`[mikrobio-dbg ${label}]`, data ?? '');
  } catch {
    /* ignore */
  }
  LISTENERS.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeDbg(listener) {
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

export function clearDbg() {
  MIKROBIO_DBG_EVENTS.length = 0;
  LISTENERS.forEach((l) => l());
}

export function isDebugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dbg') === '1') return true;
    if (window.localStorage?.getItem('mikrobio:debug') === 'on') return true;
  } catch {
    /* ignore */
  }
  return false;
}
