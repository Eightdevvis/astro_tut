import { useState, useEffect } from 'preact/hooks';
import { loadProgress, totalPercent } from '../lib/extremophile-progress.js';

// Karte fuer mikrobiologie.astro: Link aufs Extremophile-Minigame +
// Fortschrittsleiste aus localStorage. Hydratisiert client-seitig.
export default function ExtremophileMikrobioCard() {
  const [pct, setPct] = useState(null);

  useEffect(() => {
    setPct(totalPercent(loadProgress()));
  }, []);

  const value = pct ?? 0;
  return (
    <a className="emc-card" href="/minigames/mikrobiologie/extremophile">
      <span className="emc-card-title">Extremophile</span>
      <span className="emc-card-desc">
        Sechs Extrem-Klassen — eine Beispielart pro Lebensraum. Pro Kategorie sechs Fragen.
      </span>
      <span className="emc-card-progress-row">
        <span className="emc-card-bar">
          <span className="emc-card-bar-fill" style={{ width: `${value}%` }} />
        </span>
        <span className="emc-card-pct">{pct === null ? '…' : `${value} %`}</span>
      </span>
      <style>{`
        .emc-card {
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
        .emc-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
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
      `}</style>
    </a>
  );
}
