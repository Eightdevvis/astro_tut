// Generische Client-seitige Sync-Logik fuer Minigame-Fortschritt.
//
// Strategie:
//   1. UI startet mit localStorage-Wert (sofort, ohne await).
//   2. Auf Mount: GET vom Server. Wenn 401: User nicht eingeloggt,
//      bleibt local-only — keine weiteren Server-Calls.
//   3. Wenn Server-Wert vorhanden: merge(local, server) per Spielregel.
//      Liefert merged-Daten zurueck; wenn diese sich von Server-Wert
//      unterscheiden (lokaler Progress war reicher), wird automatisch
//      ein PUT hinterhergeschickt.
//   4. Aenderungen wandern via `pushChange()` in den Server hoch
//      (fire-and-forget; 401 wird stillschweigend ignoriert).
//
// Merging ist Spiel-spezifisch und wird als Funktion uebergeben.

const ENDPOINT = '/api/minigames/progress';

// Marker, dass die Session als nicht-eingeloggt erkannt wurde — dann sparen
// wir uns weitere Server-Calls fuer diesen Pageload. Pro game-ID.
const knownUnauth = new Set();

export async function pullFromServer(gameId) {
  if (typeof window === 'undefined') return { authenticated: false, payload: null };
  if (knownUnauth.has(gameId)) return { authenticated: false, payload: null };
  try {
    const res = await fetch(`${ENDPOINT}?game=${encodeURIComponent(gameId)}`, {
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      knownUnauth.add(gameId);
      return { authenticated: false, payload: null };
    }
    if (!res.ok) return { authenticated: true, payload: null };
    const data = await res.json();
    return { authenticated: true, payload: data?.payload ?? null };
  } catch {
    return { authenticated: false, payload: null };
  }
}

export async function pushToServer(gameId, payload) {
  if (typeof window === 'undefined') return false;
  if (knownUnauth.has(gameId)) return false;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: gameId, payload }),
    });
    if (res.status === 401) {
      knownUnauth.add(gameId);
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Auf Mount aufrufen. Loescht keinen lokalen State, sondern merged Server-
 * Daten ein. onMerged wird mit dem zusammengefuehrten Progress aufgerufen,
 * falls dieser sich vom uebergebenen local-Progress unterscheidet.
 *
 * - localProgress: das, was loadProgress() jetzt grade aus LS gibt.
 * - merge(serverProgress, localProgress) -> merged
 * - saveLocal(merged) -> persistiert lokal (du gibst hier saveProgress mit).
 */
export async function syncOnMount({
  gameId,
  localProgress,
  merge,
  saveLocal,
  onMerged,
}) {
  const { authenticated, payload: serverProgress } = await pullFromServer(gameId);
  if (!authenticated) return; // local-only Mode

  if (serverProgress === null) {
    // Nichts auf Server -> bisherigen Local-Stand hochpushen (falls vorhanden).
    if (hasContent(localProgress)) {
      pushToServer(gameId, localProgress);
    }
    return;
  }

  const merged = merge(serverProgress, localProgress);
  if (!shallowEqual(merged, serverProgress)) {
    // Wir hatten lokalen Progress, den der Server nicht kannte -> hochpushen.
    pushToServer(gameId, merged);
  }
  if (!shallowEqual(merged, localProgress)) {
    saveLocal(merged);
    onMerged?.(merged);
  }
}

function hasContent(progress) {
  if (!progress || typeof progress !== 'object') return false;
  for (const key of Object.keys(progress)) {
    const v = progress[key];
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return true;
  }
  return false;
}

function shallowEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
