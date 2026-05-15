import { useState, useEffect } from 'preact/hooks';
import {
  loadProgress,
  saveProgress,
  totalPercent,
  mergeProgress,
  GAME_ID,
} from '../lib/extremophile-progress.js';
import { syncOnMount } from '../lib/minigame-progress-sync.js';

// Karte fuer mikrobiologie.astro: Link aufs Extremophile-Minigame +
// Fortschrittsleiste. Auf Mount: localStorage + Server-Merge (falls auth).
export default function ExtremophileMikrobioCard() {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    const local = loadProgress();
    setProgress(local);
    syncOnMount({
      gameId: GAME_ID,
      localProgress: local,
      merge: mergeProgress,
      saveLocal: saveProgress,
      onMerged: (merged) => setProgress(merged),
    });
  }, []);

  const pct = progress ? totalPercent(progress) : 0;
  const ready = progress !== null;

  return (
    <div className="emc-card">
      <a className="emc-card-main" href="/minigames/mikrobiologie/extremophile">
        <span className="emc-card-title">Extremophile</span>
        <span className="emc-card-desc">
          Sechs Extrem-Klassen — eine Beispielart pro Lebensraum. Pro Kategorie sechs Fragen.
        </span>
        <span className="emc-card-progress-row">
          <span className="emc-card-bar">
            <span className="emc-card-bar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="emc-card-pct">{ready ? `${pct} %` : '…'}</span>
        </span>
      </a>
      <a className="emc-card-practice" href="/minigames/mikrobiologie/extremophile?ueben=1">
        Uebung &rarr;
      </a>
      <style>{`
        .emc-card {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding: 1rem 1.1rem 0.7rem;
          background: var(--site-card-bg);
          border: 1px solid var(--site-card-border);
          border-radius: 0.9rem;
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .emc-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
        }
        .emc-card-main {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          color: inherit;
          text-decoration: none;
        }
        .emc-card-title {
          font-weight: 700;
          font-size: 1.1rem;
        }
        .emc-card-desc {
          color: var(--site-muted);
          line-height: 1.45;
        }
        .emc-card-progress-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-top: 0.2rem;
        }
        .emc-card-bar {
          flex: 1;
          height: 0.45rem;
          border-radius: 0.3rem;
          background: rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }
        .emc-card-bar-fill {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #b8633a, #6a8caf);
          transition: width 0.4s ease;
        }
        .emc-card-pct {
          font-variant-numeric: tabular-nums;
          color: var(--site-muted);
          font-size: 0.9rem;
        }
        .emc-card-practice {
          align-self: flex-end;
          margin-top: 0.3rem;
          color: var(--site-soft-muted);
          text-decoration: none;
          font-size: 0.85rem;
          padding: 0.15rem 0.4rem;
          border-radius: 0.35rem;
        }
        .emc-card-practice:hover {
          color: var(--site-body-text);
          background: rgba(0, 0, 0, 0.04);
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
