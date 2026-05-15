import { useState, useEffect } from 'preact/hooks';
import {
  loadProgress,
  saveProgress,
  totalScore,
  mergeProgress,
  GAME_ID,
} from '../lib/archaea-lipids-progress.js';
import { syncOnMount } from '../lib/minigame-progress-sync.js';

// Karte für mikrobiologie.astro: Link aufs Minigame + Fortschrittsleiste.
// Auf Mount: lokalen Progress (sofort sichtbar) plus Server-Merge (falls
// eingeloggt). Den Übungs-Einstieg gibt's drinnen im Game-Home, nicht auf
// dieser Karte.
export default function ArchaeaLipidsMikrobioCard() {
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

  const pct = progress ? totalScore(progress) : 0;
  const ready = progress !== null;

  return (
    <a
      className="alc-card"
      href="/minigames/mikrobiologie/archaea-membran-lipide"
    >
      <span className="alc-card-title">Archaea: Membran: Lipide</span>
      <span className="alc-card-desc">
        Drei Archaea-Lipide erkennen (Level&nbsp;1) und nachbauen (Level&nbsp;2).
      </span>
      <span className="alc-card-progress-row">
        <span className="alc-card-bar">
          <span className="alc-card-bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="alc-card-pct">{ready ? `${pct} %` : '…'}</span>
      </span>
      <style>{`
        .alc-card {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding: 1rem 1.1rem;
          background: var(--site-card-bg);
          border: 1px solid var(--site-card-border);
          border-radius: 0.9rem;
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
          color: inherit;
          text-decoration: none;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .alc-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
        }
        .alc-card-title {
          font-weight: 700;
          font-size: 1.1rem;
        }
        .alc-card-desc {
          color: var(--site-muted);
          line-height: 1.45;
        }
        .alc-card-progress-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-top: 0.2rem;
        }
        .alc-card-bar {
          flex: 1;
          height: 0.45rem;
          border-radius: 0.3rem;
          background: rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }
        .alc-card-bar-fill {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #6a8caf, #3d8a59);
          transition: width 0.4s ease;
        }
        .alc-card-pct {
          font-variant-numeric: tabular-nums;
          color: var(--site-muted);
          font-size: 0.9rem;
        }
      `}</style>
    </a>
  );
}
