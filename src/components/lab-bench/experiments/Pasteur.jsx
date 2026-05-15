import { useState, useEffect } from 'preact/hooks';
import LabBench from '../LabBench.jsx';

// Pasteur-Experiment-Wrapper:
//   1. Intro-Szene: Pasteur-Portrait + Gedanken-Blase + Weiter-Knopf.
//      Funktional auch ein Loading-Buffer fuer den LabBench (SVGs/Items).
//   2. Weiter-Klick: LabBench-Szene aktiviert.
//
// Per `?skip=1` springt die Intro fuer Debugging weg.
export default function Pasteur({ skipIntro = false }) {
  const [phase, setPhase] = useState(skipIntro ? 'lab' : 'intro');

  // Bei Phase-Wechsel zum Scroll-Top, damit der LabBench oben anfaengt.
  useEffect(() => {
    if (phase === 'lab' && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [phase]);

  if (phase === 'intro') {
    return <Intro onContinue={() => setPhase('lab')} />;
  }
  return <LabBench />;
}

function Intro({ onContinue }) {
  return (
    <div className="pst-intro-wrap">
      <svg viewBox="0 0 720 380" className="pst-intro-svg" aria-hidden="true">
        <PasteurPortrait />
        <ArrowAndLabel />
        <ThoughtBubble />
      </svg>
      <button type="button" className="pst-intro-btn" onClick={onContinue}>
        Weiter
      </button>
      <Styles />
    </div>
  );
}

function PasteurPortrait() {
  // Stilisiertes Halbportrait. ~140 breit, ~210 hoch. Positioniert links.
  return (
    <g transform="translate(60, 60)">
      {/* Schulter / Anzug */}
      <path
        d="M -10 175 Q 70 185 150 175 L 165 215 L -25 215 Z"
        fill="#2a2f4a"
        stroke="#1a1f3a"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
      {/* Hemdkragen-V */}
      <path d="M 55 180 L 70 196 L 85 180 L 85 168 L 55 168 Z" fill="#f0e8d8" stroke="#9c8a64" stroke-width="0.8" />
      {/* Fliege */}
      <path d="M 55 175 L 42 182 L 55 189 Z" fill="#4a2a1a" stroke="#1a0a00" stroke-width="0.6" />
      <path d="M 85 175 L 98 182 L 85 189 Z" fill="#4a2a1a" stroke="#1a0a00" stroke-width="0.6" />
      <circle cx="70" cy="182" r="3" fill="#3a1a0a" />
      {/* Kopf-Oval */}
      <ellipse cx="70" cy="90" rx="48" ry="58" fill="#f4d8b8" stroke="#7a5a3a" stroke-width="1.5" />
      {/* Haar: Seitenpartien + duenner Streifen oben */}
      <path
        d="M 24 80 Q 18 48 28 30 Q 36 32 32 80 Z"
        fill="#9c9c9c"
        stroke="#6a6a6a"
        stroke-width="0.8"
      />
      <path
        d="M 116 80 Q 122 48 112 30 Q 104 32 108 80 Z"
        fill="#9c9c9c"
        stroke="#6a6a6a"
        stroke-width="0.8"
      />
      <path
        d="M 30 38 Q 70 28 110 38 Q 110 46 70 42 Q 30 46 30 38 Z"
        fill="#9c9c9c"
        stroke="#6a6a6a"
        stroke-width="0.8"
      />
      {/* Augenbrauen */}
      <path d="M 50 78 Q 58 74 66 78" fill="none" stroke="#5a5a5a" stroke-width="1.8" stroke-linecap="round" />
      <path d="M 74 78 Q 82 74 90 78" fill="none" stroke="#5a5a5a" stroke-width="1.8" stroke-linecap="round" />
      {/* Augen */}
      <ellipse cx="58" cy="86" rx="2.5" ry="3.2" fill="#1a1a1a" />
      <ellipse cx="82" cy="86" rx="2.5" ry="3.2" fill="#1a1a1a" />
      {/* Nase */}
      <path d="M 70 96 Q 67 110 70 116 Q 73 118 76 116" fill="none" stroke="#7a5a3a" stroke-width="1.2" stroke-linecap="round" />
      {/* Bushy Mustache */}
      <path
        d="M 48 124 Q 58 116 70 122 Q 82 116 92 124 Q 96 134 80 134 Q 70 130 60 134 Q 44 134 48 124 Z"
        fill="#9c9c9c"
        stroke="#6a6a6a"
        stroke-width="0.8"
        stroke-linejoin="round"
      />
      {/* Mund */}
      <path d="M 60 138 Q 70 142 80 138" fill="none" stroke="#7a4040" stroke-width="1.2" stroke-linecap="round" />
      {/* Goatee */}
      <path
        d="M 56 144 Q 70 156 84 144 Q 78 158 70 162 Q 62 158 56 144 Z"
        fill="#9c9c9c"
        stroke="#6a6a6a"
        stroke-width="0.8"
        stroke-linejoin="round"
      />
    </g>
  );
}

function ArrowAndLabel() {
  return (
    <g>
      {/* Pfeil von rechts unten hoch zum Kopf */}
      <path
        d="M 200 310 Q 220 285 175 245 Q 145 215 130 192"
        fill="none"
        stroke="#c43a3a"
        stroke-width="2.4"
        stroke-linecap="round"
      />
      {/* Pfeilspitze */}
      <polygon
        points="130,192 138,202 124,205"
        fill="#c43a3a"
        stroke="#a02a2a"
        stroke-width="0.8"
        stroke-linejoin="round"
      />
      {/* Label */}
      <text
        x="208"
        y="332"
        font-size="18"
        font-weight="800"
        fill="#c43a3a"
        font-family="ui-sans-serif, system-ui, sans-serif"
      >
        Pasteur
      </text>
    </g>
  );
}

function ThoughtBubble() {
  return (
    <g>
      {/* Bubble-Punkte als Verbindung Kopf -> Wolke */}
      <circle cx="240" cy="140" r="4.5" fill="#fff" stroke="#5a6a76" stroke-width="1.2" />
      <circle cx="262" cy="118" r="6.5" fill="#fff" stroke="#5a6a76" stroke-width="1.2" />
      <circle cx="290" cy="98" r="8" fill="#fff" stroke="#5a6a76" stroke-width="1.3" />
      {/* Hauptwolke (mehrere ueberlappende Boegen) */}
      <path
        d="M 330 60
           C 318 38, 358 30, 372 50
           C 388 32, 432 38, 440 60
           C 478 50, 510 70, 502 96
           C 528 100, 528 132, 502 138
           C 510 162, 478 178, 446 168
           C 432 184, 388 184, 372 168
           C 350 184, 322 168, 322 144
           C 296 142, 296 102, 320 100
           C 308 80, 318 64, 330 60 Z"
        fill="#fff"
        stroke="#5a6a76"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      {/* Text */}
      <text x="412" y="82" text-anchor="middle" font-size="14" font-weight="700" fill="#1a1a1a" font-family="ui-sans-serif, system-ui, sans-serif">
        Spontanzeugung ist Muell.
      </text>
      <text x="412" y="102" text-anchor="middle" font-size="13" fill="#2a2a2a" font-family="ui-sans-serif, system-ui, sans-serif">
        Aber wie beweise ich es?
      </text>
      <text x="412" y="128" text-anchor="middle" font-size="11" fill="#5a5a5a" font-style="italic" font-family="ui-sans-serif, system-ui, sans-serif">
        Wo Vergammelung anfaengt geht
      </text>
      <text x="412" y="142" text-anchor="middle" font-size="11" fill="#5a5a5a" font-style="italic" font-family="ui-sans-serif, system-ui, sans-serif">
        die Vergammelung auch weiter…
      </text>
      <text x="412" y="160" text-anchor="middle" font-size="13" font-weight="700" fill="#1a1a1a" font-family="ui-sans-serif, system-ui, sans-serif">
        Hmmmmm
      </text>
    </g>
  );
}

function Styles() {
  return (
    <style>{`
      .pst-intro-wrap {
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        padding: 1rem 0;
      }
      .pst-intro-svg {
        width: 100%;
        max-width: 760px;
        height: auto;
        display: block;
        border-radius: 1rem;
        background: linear-gradient(180deg, #f4ecd8 0%, #e8d8b8 100%);
        box-shadow: 0 2px 14px rgba(0, 0, 0, 0.18);
      }
      .pst-intro-btn {
        appearance: none;
        border: 1px solid var(--site-card-border);
        background: var(--site-card-bg);
        color: var(--site-body-text);
        padding: 0.7rem 2rem;
        font: inherit;
        font-weight: 700;
        font-size: 1.05rem;
        border-radius: 0.7rem;
        cursor: pointer;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
        transition: transform 0.18s ease, box-shadow 0.18s ease;
      }
      .pst-intro-btn:hover {
        transform: translateY(-2px);
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
      }
      .pst-intro-btn:focus-visible {
        outline: 2px solid var(--site-accent, #6a8caf);
        outline-offset: 2px;
      }
    `}</style>
  );
}
