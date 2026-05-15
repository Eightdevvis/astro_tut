import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import {
  ARCHAEA_LIPIDS,
  LIPID_TARGET_ATOMS,
  isNameCorrect,
} from '../lib/archaea-lipids.js';
import {
  loadProgress,
  saveProgress,
  markLevel1,
  markLevel2,
  totalScore,
  level1Percent,
  level2Percent,
  mergeProgress,
  GAME_ID,
} from '../lib/archaea-lipids-progress.js';
import { tierFromScore, isPassing, SCORE_TIERS } from '../lib/scoring-scale.js';
import { syncOnMount, pushToServer } from '../lib/minigame-progress-sync.js';
import ArchaeaLipidsConfetti from './ArchaeaLipidsConfetti.jsx';
import MikrobioDebugPanel from './MikrobioDebugPanel.jsx';
import { dbg } from '../lib/mikrobio-debug.js';

const MoleculeBuilderCanvas = lazy(async () => {
  dbg('canvas-chunk-import-start');
  try {
    const mod = await import('./MoleculeBuilderCanvas.jsx');
    dbg('canvas-chunk-import-done', { hasDefault: Boolean(mod?.default) });
    return mod;
  } catch (err) {
    dbg('canvas-chunk-import-failed', { msg: String(err?.message || err) });
    throw err;
  }
});

// Atomzaehlung aus einem MOL-File-String. MOL-V2000-Atomblock-Format:
// jede Atom-Zeile ist 70+ Zeichen, Spalten 31-34 enthalten das Element-Symbol.
function parseAtomCountsFromMolfile(molfile) {
  const counts = {};
  if (!molfile) return counts;
  const lines = molfile.split(/\r?\n/);
  // Zeile 4 (Index 3) ist die counts line: "  NN MM ...".
  if (lines.length < 4) return counts;
  const countsLine = lines[3];
  const numAtoms = parseInt(countsLine.slice(0, 3).trim(), 10);
  if (!Number.isFinite(numAtoms) || numAtoms <= 0) return counts;
  // Atom-Block startet bei Zeile 5 (Index 4).
  for (let i = 0; i < numAtoms; i++) {
    const line = lines[4 + i];
    if (!line) break;
    // Element-Symbol ab Spalte 31, 3 Zeichen breit.
    const elem = line.slice(31, 34).trim();
    if (!elem || elem === 'H') continue;
    counts[elem] = (counts[elem] || 0) + 1;
  }
  return counts;
}

// Gewichteter Aehnlichkeits-Score 0..100.
// Hauptgeruest (C-Zahl) dominiert; Heteroatome und Phosphat-Anwesenheit
// fuellen die Naehe-Prozente. Tippt der User komplett leer, kommt 0 raus.
// User: "hauptgeruest als hauptprozent, drum rum zaehlen".
function similarityScore(userAtoms, targetAtoms) {
  const weights = { C: 0.65, O: 0.18, P: 0.1, N: 0.04, S: 0.03 };
  const elements = new Set([
    ...Object.keys(userAtoms),
    ...Object.keys(targetAtoms),
  ]);
  let weightSum = 0;
  let weighted = 0;
  for (const el of elements) {
    const w = weights[el] ?? 0.02;
    const u = userAtoms[el] || 0;
    const t = targetAtoms[el] || 0;
    if (u === 0 && t === 0) continue;
    const diff = Math.abs(u - t);
    const denom = Math.max(t, u, 1);
    const sim = Math.max(0, 1 - diff / denom);
    weighted += sim * w;
    weightSum += w;
  }
  if (weightSum === 0) return 0;
  return Math.round((weighted / weightSum) * 100);
}

// L1-Prompt-Bilder: Simolecule CDK Depict gibt fertige SVGs fuer einen SMILES.
// Browser cached die Antworten anhand der URL. Reicht, weil unsere drei Lipide
// fix sind. Vorher lief das ueber `ketcher.generateImage` — Ketcher mountet
// aber im Preact-Compat-Setup nicht sauber, siehe enterL1-Kommentar.
function lipidImageUrl(smiles) {
  return `https://www.simolecule.com/cdkdepict/depict/bow/svg?smi=${encodeURIComponent(smiles)}&abbr=on&disp=bridgehead&zoom=1.0&hdisp=provided&showtitle=false`;
}

function useKetcherReady() {
  const [ketcher, setKetcher] = useState(null);
  const handleReady = (k) => {
    dbg('useKetcherReady-setKetcher', {
      type: typeof k,
      hasGenerateImage: typeof k?.generateImage === 'function',
    });
    setKetcher(k);
  };
  return [ketcher, handleReady];
}

export default function ArchaeaLipidsGame({ mode: initialMode = 'play' }) {
  // 'home' | 'l1' | 'l2' (oder 'practice' wenn initialMode === 'practice')
  const [mode, setMode] = useState(initialMode === 'practice' ? 'practice' : 'home');
  const [progress, setProgress] = useState(() => loadProgress());
  // Im Practice-Mode wird der Editor sofort gemountet, damit die Targets
  // gerendert werden koennen.
  const [editorMounted, setEditorMounted] = useState(initialMode === 'practice');
  const [ketcher, onKetcherReady] = useKetcherReady();

  useEffect(() => {
    dbg('game-mount', {
      ua:
        typeof navigator !== 'undefined'
          ? navigator.userAgent.slice(0, 120)
          : null,
      initialMode,
      editorMounted,
    });
    return () => dbg('game-unmount');
  }, []);

  useEffect(() => {
    dbg('mode-change', { mode, editorMounted });
  }, [mode, editorMounted]);

  // Server-Sync auf Mount: lokalen Progress mit Server mergen (falls eingeloggt).
  useEffect(() => {
    syncOnMount({
      gameId: GAME_ID,
      localProgress: loadProgress(),
      merge: mergeProgress,
      saveLocal: saveProgress,
      onMerged: (merged) => setProgress(merged),
    });
  }, []);

  const persistChange = (updated) => {
    setProgress(updated);
    pushToServer(GAME_ID, updated);
  };

  // Bilder pro Lipid kommen jetzt extern (Simolecule CDK Depict, siehe
  // `lipidImageUrl`) — kein Ketcher-Render-Loop mehr. Browser-Cache haelt
  // die drei URLs nach dem ersten Laden.
  const targetAtoms = LIPID_TARGET_ATOMS;
  // Targets sind bereit, sobald Ketcher mountet — Atomzaehlungen brauchen ihn nicht.
  const targetsReady = Boolean(ketcher);
  // Dummy fuer kompatible View-Props (Practice/L2-Reveal greifen weiterhin
  // auf "lipidImages" zu, holen sich aber per lipidImageUrl).
  const lipidImages = useMemo(
    () =>
      Object.fromEntries(
        ARCHAEA_LIPIDS.map((l) => [l.id, lipidImageUrl(l.smiles)]),
      ),
    [],
  );

  // (Frueher: Ketcher-generateImage-Loop — komplett entfernt, weil Ketcher
  // hier nicht sauber mountet und wir die Bilder eh extern beziehen.)
  useEffect(() => {
    if (ketcher) dbg('ketcher-state-set', { keys: Object.keys(ketcher).slice(0, 20) });
  }, [ketcher]);

  // Ketcher-Bundle ist gross (mehrere MB inkl. WASM). Sobald die Game-Seite
  // mountet, den Lazy-Chunk schonmal im Hintergrund holen — dann ist er beim
  // Klick auf L1/L2 idealerweise schon im Cache.
  useEffect(() => {
    const t0 = performance.now();
    dbg('prefetch-start');
    import('./MoleculeBuilderCanvas.jsx')
      .then(() =>
        dbg('prefetch-done', { ms: Math.round(performance.now() - t0) }),
      )
      .catch((err) =>
        dbg('prefetch-failed', { msg: String(err?.message || err) }),
      );
  }, []);

  const ensureEditor = () => setEditorMounted(true);

  const goHome = () => setMode('home');
  // Ketcher mounten wir NUR fuer L2 (User zeichnet selbst). L1 zeigt nur ein
  // SVG-Bild der Target-Struktur — das holen wir extern via Simolecule CDK
  // Depict (`lipidImageUrl`), kein Ketcher-Mount noetig. Hintergrund: Ketcher
  // 3.12 + Preact-Compat-Shim crasht im Mount-Lifecycle ("'ci' in null"
  // Endlosschleife + 4x null.render + ResizeObserver.observe(null)) — siehe
  // Mikrobio-Debug-Log. Bis Ketcher hier sauber mountet, halten wir's aus L1
  // raus.
  const enterL1 = () => setMode('l1');
  const enterL2 = () => {
    ensureEditor();
    setMode('l2');
  };

  const refreshProgress = () => {
    const p = loadProgress();
    setProgress(p);
    pushToServer(GAME_ID, p);
  };

  return (
    <section className="alg-root">
      <header className="alg-header">
        <h1 className="alg-title">Archaea: Membran: Lipide</h1>
        <p className="alg-sub">
          Drei Lipide der Archaea-Membran erkennen und nachbauen. Konfetti ab 85&nbsp;%,
          mehr ab 95&nbsp;%, goldenes Konfetti bei 100&nbsp;%.
        </p>
      </header>

      {mode === 'home' && (
        <HomeView
          progress={progress}
          onL1={enterL1}
          onL2={enterL2}
          targetsReady={targetsReady}
          editorMounted={editorMounted}
        />
      )}

      {mode === 'practice' && (
        <PracticeView
          lipidImages={lipidImages}
          targetsReady={targetsReady}
        />
      )}

      {mode === 'l1' && (
        <Level1View
          ketcher={ketcher}
          lipidImages={lipidImages}
          targetsReady={targetsReady}
          onBack={goHome}
          onProgress={refreshProgress}
        />
      )}

      {mode === 'l2' && (
        <Level2View
          ketcher={ketcher}
          lipidImages={lipidImages}
          targetAtoms={targetAtoms}
          targetsReady={targetsReady}
          onBack={goHome}
          onProgress={refreshProgress}
        />
      )}

      {editorMounted && (
        <Suspense
          fallback={
            <div className="alg-editor-loading">Ketcher laedt&hellip;</div>
          }
        >
          {/*
            Ketcher/Konva crasht beim Mount in einem off-screen-Container
            (`position:fixed; left:-10000px`) — endlose `'ci' in null` und
            `ResizeObserver.observe(null)`-Fehler, weil interne DOM-Lookups
            ins Leere greifen. Bis dafuer eine saubere Loesung steht, mounten
            wir den Editor *immer* in seinem sichtbaren Layout-Slot.
            UX-Trade-Off in L1: Editor ist sichtbar unter dem Quiz; in L2
            ist er ohnehin das Hauptelement.
          */}
          <div
            className="alg-editor-shell alg-editor-shell--visible"
            aria-hidden={mode === 'l1'}
          >
            <MoleculeBuilderCanvas onReady={onKetcherReady} />
          </div>
        </Suspense>
      )}

      <Styles />
      <MikrobioDebugPanel />
    </section>
  );
}

function HomeView({ progress, onL1, onL2, targetsReady, editorMounted }) {
  const total = totalScore(progress);
  const l1pct = level1Percent(progress);
  const l2pct = level2Percent(progress);
  const loadingHint = editorMounted && !targetsReady;
  return (
    <div className="alg-home">
      <div className="alg-progress-block">
        <div className="alg-progress-row">
          <span className="alg-progress-label">Gesamt</span>
          <span className="alg-progress-value">{total}&nbsp;%</span>
        </div>
        <div className="alg-progress-bar">
          <div className="alg-progress-fill" style={{ width: `${total}%` }} />
        </div>
      </div>
      <div className="alg-level-grid">
        <button
          type="button"
          className="alg-level-card"
          onClick={onL1}
          disabled={loadingHint}
        >
          <span className="alg-level-card-tag">Level 1</span>
          <span className="alg-level-card-title">Namen tippen</span>
          <span className="alg-level-card-desc">
            Du siehst die Struktur, du tippst den Namen. Drei Lipide nacheinander.
          </span>
          <span className="alg-level-card-progress-row">
            <span className="alg-level-card-bar">
              <span
                className="alg-level-card-bar-fill"
                style={{ width: `${l1pct}%` }}
              />
            </span>
            <span className="alg-level-card-pct">{l1pct}&nbsp;%</span>
          </span>
        </button>
        <button
          type="button"
          className="alg-level-card"
          onClick={onL2}
          disabled={loadingHint}
        >
          <span className="alg-level-card-tag">Level 2</span>
          <span className="alg-level-card-title">Strukturen bauen</span>
          <span className="alg-level-card-desc">
            Name oben, Editor unten. Mit Ketcher das Lipid nachbauen, pruefen,
            sehen wie nah du dran warst.
          </span>
          <span className="alg-level-card-progress-row">
            <span className="alg-level-card-bar">
              <span
                className="alg-level-card-bar-fill"
                style={{ width: `${l2pct}%` }}
              />
            </span>
            <span className="alg-level-card-pct">{l2pct}&nbsp;%</span>
          </span>
        </button>
      </div>
      {loadingHint && (
        <p className="alg-loading-hint">
          Ketcher und Lipid-Daten werden geladen&hellip;
        </p>
      )}
    </div>
  );
}

function Level1View({ ketcher, lipidImages, targetsReady, onBack, onProgress }) {
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState('');
  // null | { ok: boolean }
  const [feedback, setFeedback] = useState(null);
  const [confetti, setConfetti] = useState({ tier: 'none', runId: 0 });

  const lipid = ARCHAEA_LIPIDS[idx];
  const imageUrl = lipidImages[lipid?.id];

  const done = idx >= ARCHAEA_LIPIDS.length;

  const handleCheck = () => {
    if (!lipid) return;
    const ok = isNameCorrect(input, lipid);
    setFeedback({ ok });
    markLevel1(lipid.id, ok);
    onProgress();
    if (ok) {
      // L1 ist binaer richtig oder falsch -> bei richtig immer 'confetti'-Tier.
      setConfetti({ tier: 'confetti', runId: Date.now() });
    }
  };

  const handleNext = () => {
    setInput('');
    setFeedback(null);
    setIdx((v) => v + 1);
  };

  if (done) {
    return (
      <div className="alg-level">
        <p className="alg-level-back">
          <button type="button" onClick={onBack}>
            &larr; Zurueck zur Auswahl
          </button>
        </p>
        <div className="alg-level-finished">
          <p className="alg-level-finished-title">Level&nbsp;1 durch.</p>
          <p className="alg-level-finished-hint">
            Probier Level&nbsp;2 — bauen statt tippen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="alg-level">
      <div className="alg-level-topline">
        <p className="alg-level-back">
          <button type="button" onClick={onBack}>
            &larr; Zurueck zur Auswahl
          </button>
        </p>
        <p className="alg-level-counter">
          Lipid {idx + 1} von {ARCHAEA_LIPIDS.length}
        </p>
      </div>
      <h2 className="alg-level-title">Level&nbsp;1 — Namen tippen</h2>
      <div className="alg-l1-imagewrap">
        {imageUrl ? (
          <img className="alg-l1-image" src={imageUrl} alt="Lipid-Struktur" />
        ) : (
          <p className="alg-l1-imagewait">Struktur wird gerendert…</p>
        )}
      </div>
      <div className="alg-l1-input-row">
        <label className="alg-l1-label" htmlFor="alg-l1-input">
          Wie heisst dieses Lipid?
        </label>
        <input
          id="alg-l1-input"
          className="alg-l1-input"
          type="text"
          value={input}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={feedback !== null}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && feedback === null && input.trim()) {
              handleCheck();
            }
          }}
        />
        {feedback === null && (
          <button
            type="button"
            className="alg-l1-checkbtn"
            onClick={handleCheck}
            disabled={!input.trim()}
          >
            Pruefen
          </button>
        )}
        {feedback && feedback.ok && (
          <>
            <span className="alg-feedback alg-feedback--yay">YAY</span>
            <button
              type="button"
              className="alg-l1-checkbtn"
              onClick={handleNext}
            >
              Naechstes
            </button>
          </>
        )}
        {feedback && !feedback.ok && (
          <>
            <span className="alg-feedback alg-feedback--x">
              X &mdash; richtig: <strong>{lipid.name}</strong>
            </span>
            <button
              type="button"
              className="alg-l1-checkbtn"
              onClick={handleNext}
            >
              Naechstes
            </button>
          </>
        )}
      </div>
      <ArchaeaLipidsConfetti
        tier={confetti.tier}
        runId={confetti.runId}
      />
    </div>
  );
}

function Level2View({
  ketcher,
  lipidImages,
  targetAtoms,
  targetsReady,
  onBack,
  onProgress,
}) {
  const [idx, setIdx] = useState(0);
  // null | { score, ok, tier }
  const [feedback, setFeedback] = useState(null);
  const [confetti, setConfetti] = useState({ tier: 'none', runId: 0 });
  const [checking, setChecking] = useState(false);

  const lipid = ARCHAEA_LIPIDS[idx];
  const correctImageUrl = lipidImages[lipid?.id];

  const done = idx >= ARCHAEA_LIPIDS.length;

  // Editor leeren wenn Lipid wechselt und Ketcher da ist.
  useEffect(() => {
    if (!ketcher || done) return;
    let cancelled = false;
    (async () => {
      try {
        await ketcher.setMolecule('');
      } catch {
        /* ignore */
      }
      if (!cancelled) setFeedback(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [ketcher, idx, done]);

  const handleCheck = async () => {
    if (!ketcher || !lipid || checking) return;
    setChecking(true);
    try {
      const molfile = await ketcher.getMolfile();
      const userAtoms = parseAtomCountsFromMolfile(molfile);
      const target = targetAtoms[lipid.id] || {};
      const score = similarityScore(userAtoms, target);
      const tier = tierFromScore(score);
      const ok = isPassing(score);
      setFeedback({ score, ok, tier });
      markLevel2(lipid.id, score);
      onProgress();
      if (tier !== 'none') {
        setConfetti({ tier, runId: Date.now() });
      }
    } catch (err) {
      console.error('[ArchaeaLipids] check failed', err);
      setFeedback({ score: 0, ok: false, tier: 'none' });
    } finally {
      setChecking(false);
    }
  };

  const handleNext = () => {
    setFeedback(null);
    setIdx((v) => v + 1);
  };

  if (done) {
    return (
      <div className="alg-level">
        <p className="alg-level-back">
          <button type="button" onClick={onBack}>
            &larr; Zurueck zur Auswahl
          </button>
        </p>
        <div className="alg-level-finished">
          <p className="alg-level-finished-title">Level&nbsp;2 durch.</p>
          <p className="alg-level-finished-hint">
            Schau auf der Karte, was rauskam.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="alg-level">
      <div className="alg-level-topline">
        <p className="alg-level-back">
          <button type="button" onClick={onBack}>
            &larr; Zurueck zur Auswahl
          </button>
        </p>
        <p className="alg-level-counter">
          Lipid {idx + 1} von {ARCHAEA_LIPIDS.length}
        </p>
      </div>
      <h2 className="alg-level-title">Level&nbsp;2 — Strukturen bauen</h2>
      <div className="alg-l2-namebar">
        {feedback && !feedback.ok && correctImageUrl ? (
          <div className="alg-l2-reveal">
            <p className="alg-l2-reveal-caption">
              Falsch &mdash; <strong>{lipid.name}</strong> sieht so aus:
            </p>
            <img
              className="alg-l2-reveal-image"
              src={correctImageUrl}
              alt={`${lipid.name} (Loesung)`}
            />
          </div>
        ) : (
          <div className="alg-l2-name">
            <span className="alg-l2-name-label">Baue:</span>
            <span className="alg-l2-name-value">{lipid.name}</span>
          </div>
        )}
        <div className="alg-l2-actions">
          {feedback === null && (
            <button
              type="button"
              className="alg-l2-checkbtn"
              onClick={handleCheck}
              disabled={!targetsReady || !ketcher || checking}
            >
              {checking ? 'pruefe…' : 'Pruefen'}
            </button>
          )}
          {feedback && (
            <>
              <span
                className={`alg-feedback alg-feedback--${
                  feedback.ok ? 'yay' : 'x'
                }`}
              >
                {feedback.ok ? `YAY (${feedback.score} %)` : `X (${feedback.score} %)`}
              </span>
              <button
                type="button"
                className="alg-l2-checkbtn"
                onClick={handleNext}
              >
                Naechstes
              </button>
            </>
          )}
        </div>
      </div>
      <p className="alg-l2-hint">
        Bau das Lipid im Editor unten nach. Pruef-Score zaehlt Atomtypen
        (Hauptgeruest dominiert).
      </p>
      <ArchaeaLipidsConfetti
        tier={confetti.tier}
        runId={confetti.runId}
      />
    </div>
  );
}

function PracticeView({ lipidImages, targetsReady }) {
  return (
    <div className="alg-practice">
      <p className="alg-practice-hint">
        Uebungs-Modus — alle drei Lipide mit Namen und Struktur. Kein Punkten,
        kein Speichern.
      </p>
      {ARCHAEA_LIPIDS.map((lipid) => (
        <article key={lipid.id} className="alg-practice-card">
          <h2 className="alg-practice-name">{lipid.name}</h2>
          <p className="alg-practice-hint-text">{lipid.hint}</p>
          <div className="alg-practice-imagewrap">
            {lipidImages[lipid.id] ? (
              <img
                className="alg-practice-image"
                src={lipidImages[lipid.id]}
                alt={`Struktur: ${lipid.name}`}
              />
            ) : (
              <p className="alg-practice-imagewait">
                {targetsReady ? 'Bild fehlt.' : 'Struktur wird gerendert…'}
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .alg-root {
        width: 100%;
        min-width: 0;
        max-width: 64rem;
        margin: 0 auto;
        padding: 0 1rem 4rem;
        box-sizing: border-box;
        color: var(--site-body-text);
      }

      .alg-header {
        margin: 0 0 1.5rem;
      }

      .alg-title {
        margin: 0 0 0.3rem;
        font-size: 1.85rem;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .alg-sub {
        margin: 0;
        color: var(--site-muted);
        line-height: 1.5;
      }

      /* HOME */
      .alg-progress-block {
        margin: 0 0 1.6rem;
        padding: 0.9rem 1.1rem;
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 0.9rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .alg-progress-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 0.45rem;
      }
      .alg-progress-label {
        font-weight: 600;
      }
      .alg-progress-value {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .alg-progress-bar {
        height: 0.55rem;
        border-radius: 0.4rem;
        background: rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }
      .alg-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #6a8caf 0%, #3d8a59 100%);
        transition: width 0.4s ease;
      }

      .alg-level-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }
      @media (min-width: 40rem) {
        .alg-level-grid { grid-template-columns: 1fr 1fr; }
      }

      .alg-level-card {
        appearance: none;
        text-align: left;
        font: inherit;
        color: inherit;
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        padding: 1rem 1.1rem;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .alg-level-card:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
      }
      .alg-level-card:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .alg-level-card-tag {
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--site-soft-muted);
      }
      .alg-level-card-title {
        font-size: 1.2rem;
        font-weight: 700;
      }
      .alg-level-card-desc {
        color: var(--site-muted);
        line-height: 1.45;
      }
      .alg-level-card-progress-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-top: 0.3rem;
      }
      .alg-level-card-bar {
        flex: 1;
        height: 0.45rem;
        border-radius: 0.3rem;
        background: rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }
      .alg-level-card-bar-fill {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #6a8caf, #3d8a59);
        transition: width 0.4s ease;
      }
      .alg-level-card-pct {
        font-variant-numeric: tabular-nums;
        color: var(--site-muted);
        font-size: 0.9rem;
      }

      .alg-loading-hint {
        margin: 1rem 0 0;
        color: var(--site-muted);
        font-style: italic;
      }

      /* LEVELS */
      .alg-level {
        position: relative;
        margin-top: 0.5rem;
      }
      .alg-level-topline {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
        margin-bottom: 0.4rem;
      }
      .alg-level-back button {
        appearance: none;
        background: transparent;
        border: 0;
        cursor: pointer;
        color: var(--site-soft-muted);
        font: inherit;
        padding: 0;
      }
      .alg-level-back button:hover {
        text-decoration: underline;
      }
      .alg-level-counter {
        margin: 0;
        font-size: 0.9rem;
        color: var(--site-soft-muted);
      }
      .alg-level-title {
        margin: 0 0 1rem;
        font-size: 1.4rem;
        font-weight: 700;
      }

      .alg-level-finished {
        padding: 2rem;
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        text-align: center;
      }
      .alg-level-finished-title {
        margin: 0 0 0.3rem;
        font-size: 1.3rem;
        font-weight: 700;
      }
      .alg-level-finished-hint {
        margin: 0;
        color: var(--site-muted);
      }

      /* L1 */
      .alg-l1-imagewrap {
        padding: 1rem;
        background: #ffffff;
        border: 1px solid var(--site-card-border);
        border-radius: 0.8rem;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 14rem;
        overflow: auto;
      }
      .alg-l1-image {
        max-width: 100%;
        height: auto;
        display: block;
      }
      .alg-l1-imagewait {
        color: var(--site-muted);
        font-style: italic;
        margin: 0;
      }
      .alg-l1-input-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.6rem;
        margin-top: 1rem;
      }
      .alg-l1-label {
        font-weight: 600;
        flex-basis: 100%;
      }
      .alg-l1-input {
        flex: 1 1 18rem;
        padding: 0.55rem 0.8rem;
        border: 1px solid var(--site-card-border);
        border-radius: 0.6rem;
        background: var(--site-card-bg);
        color: var(--site-body-text);
        font: inherit;
        font-size: 1rem;
      }
      .alg-l1-input:focus-visible {
        outline: 2px solid var(--site-accent, #6a8caf);
        outline-offset: 1px;
      }
      .alg-l1-checkbtn,
      .alg-l2-checkbtn {
        appearance: none;
        border: 1px solid var(--site-card-border);
        background: var(--site-card-bg);
        color: var(--site-body-text);
        padding: 0.55rem 1rem;
        font: inherit;
        font-weight: 600;
        border-radius: 0.6rem;
        cursor: pointer;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .alg-l1-checkbtn:hover:not(:disabled),
      .alg-l2-checkbtn:hover:not(:disabled) {
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
      }
      .alg-l1-checkbtn:disabled,
      .alg-l2-checkbtn:disabled {
        opacity: 0.55;
        cursor: default;
      }

      /* L2 */
      .alg-l2-namebar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.8rem;
        padding: 0.9rem 1rem;
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 0.8rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .alg-l2-name {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        flex: 1 1 auto;
      }
      .alg-l2-name-label {
        font-size: 0.85rem;
        color: var(--site-soft-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .alg-l2-name-value {
        font-size: 1.25rem;
        font-weight: 700;
      }
      .alg-l2-actions {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-left: auto;
      }
      .alg-l2-hint {
        margin: 0.5rem 0 0.8rem;
        color: var(--site-muted);
        font-size: 0.9rem;
      }
      .alg-l2-reveal {
        flex: 1 1 100%;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .alg-l2-reveal-caption {
        margin: 0;
        color: var(--site-muted);
      }
      .alg-l2-reveal-image {
        max-width: 100%;
        height: auto;
        background: #ffffff;
        border: 1px solid var(--site-card-border);
        border-radius: 0.6rem;
        padding: 0.5rem;
        box-sizing: border-box;
      }

      .alg-feedback {
        font-weight: 700;
        padding: 0.3rem 0.6rem;
        border-radius: 0.4rem;
      }
      .alg-feedback--yay {
        background: rgba(61, 138, 89, 0.15);
        color: #2f7449;
      }
      .alg-feedback--x {
        background: rgba(208, 69, 69, 0.12);
        color: #b94b4b;
      }

      /* Editor-Shell */
      .alg-editor-shell {
        margin: 1rem 0 0;
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        overflow: hidden;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .alg-editor-shell--hidden {
        position: fixed;
        left: -10000px;
        top: 0;
        width: 900px;
        height: 600px;
        opacity: 0;
        pointer-events: none;
        border: 0;
        box-shadow: none;
      }
      .alg-editor-shell--visible {
        position: relative;
      }
      .alg-editor-loading {
        padding: 1.5rem;
        text-align: center;
        color: var(--site-muted);
      }

      /* PRACTICE */
      .alg-practice {
        display: flex;
        flex-direction: column;
        gap: 1.2rem;
      }
      .alg-practice-hint {
        margin: 0 0 0.3rem;
        color: var(--site-muted);
        font-style: italic;
      }
      .alg-practice-card {
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        padding: 1rem 1.1rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .alg-practice-name {
        margin: 0 0 0.3rem;
        font-size: 1.3rem;
        font-weight: 700;
      }
      .alg-practice-hint-text {
        margin: 0 0 0.6rem;
        color: var(--site-muted);
        line-height: 1.5;
      }
      .alg-practice-imagewrap {
        padding: 0.6rem;
        background: #ffffff;
        border-radius: 0.6rem;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 9rem;
        overflow: auto;
      }
      .alg-practice-image {
        max-width: 100%;
        height: auto;
      }
      .alg-practice-imagewait {
        color: var(--site-muted);
        font-style: italic;
        margin: 0;
      }
    `}</style>
  );
}
