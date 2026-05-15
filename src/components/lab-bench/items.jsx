// SVG-Item-Renderer + Meta-Daten fuer die LabBench-Szene.
//
// Konvention:
//   - Jeder Item-Renderer ist ein Preact-Komponent, der seinen Inhalt in
//     SVG-Koordinaten zeichnet. Die Komponente wird vom Bench in einer
//     <g transform="translate(x,y)"> Gruppe gerendert.
//   - Lokales Koordinatensystem pro Item: Ursprung (0,0) ist die linke obere
//     Ecke der Bounding-Box, deren Groesse in ITEM_META[type].w/h steht.
//   - State-Objekt fuer Animationen/Toggles (z. B. Bunsen.on, Flask.rotation).
//   - SnapSlots geben Plaetze an, wo andere Items andocken duerfen (Koordinaten
//     relativ zum eigenen Ursprung). Bench prueft beim Drop auf Naehe.
//
// SVGs sind bewusst schlicht (Linien-Skizze mit dezenten Fuellungen), aehnlich
// dem Lehrbuch-Stil. Keine externe Assets — alles inline gezeichnet.

export const ITEM_META = {
  bunsen: {
    w: 70,
    h: 120,
    interaction: 'toggle',
    label: 'Bunsenbrenner',
  },
  stand: {
    w: 110,
    h: 180,
    snapSlots: [
      { x: 70, y: 60, accepts: ['flask_round', 'flask_erlenmeyer', 'flask_pasteur'] },
    ],
    label: 'Stativ mit Klemme',
  },
  flask_round: {
    w: 70,
    h: 100,
    kind: 'vessel',
    interaction: 'rotate',
    label: 'Rundkolben',
  },
  flask_erlenmeyer: {
    w: 70,
    h: 100,
    kind: 'vessel',
    interaction: 'rotate',
    label: 'Erlenmeyerkolben',
  },
  flask_pasteur: {
    w: 100,
    h: 150,
    kind: 'vessel',
    interaction: 'rotate',
    label: 'Pasteur-Schwanenhalskolben',
  },
  test_tube: {
    w: 24,
    h: 90,
    kind: 'vessel',
    label: 'Reagenzglas',
  },
  bottle_sterile: {
    w: 50,
    h: 90,
    kind: 'source',  // wird beim Drop in pour-Event verwandelt, nicht platziert
    label: 'Sterile Fluessigkeit',
    liquidColor: '#f0e6c8',
  },
  bottle_unsterile: {
    w: 50,
    h: 90,
    kind: 'source',
    label: 'Unsterile Fluessigkeit',
    liquidColor: '#c8a55a',
  },
  petri_dish: {
    w: 60,
    h: 20,
    label: 'Petrischale',
  },
  beaker: {
    w: 60,
    h: 80,
    kind: 'vessel',
    interaction: 'menu',
    label: 'Becherglas',
  },
  tongs: {
    w: 40,
    h: 90,
    label: 'Tiegelzange',
  },
};

export function renderItem(type, state = {}) {
  switch (type) {
    case 'bunsen':
      return <Bunsen state={state} />;
    case 'stand':
      return <Stand />;
    case 'flask_round':
      return <RoundFlask state={state} />;
    case 'flask_erlenmeyer':
      return <ErlenmeyerFlask state={state} />;
    case 'flask_pasteur':
      return <PasteurFlask state={state} />;
    case 'test_tube':
      return <TestTube state={state} />;
    case 'bottle_sterile':
      return <ReagentBottle color={ITEM_META.bottle_sterile.liquidColor} label="steril" />;
    case 'bottle_unsterile':
      return <ReagentBottle color={ITEM_META.bottle_unsterile.liquidColor} label="unsteril" />;
    case 'petri_dish':
      return <PetriDish />;
    case 'beaker':
      return <Beaker state={state} />;
    case 'tongs':
      return <Tongs />;
    default:
      return null;
  }
}

// Liquid + Kontaminations-Overlay: zeichnet schmutzige Punkte ueber die
// Fluessigkeit, wenn `state.contaminated` gesetzt ist. Wird von den Flask-
// Renderern aufgerufen, nachdem die Fluessigkeit gezeichnet wurde.
function ContaminationDots({ cx, cy, rx, ry, count = 14 }) {
  // Pseudo-zufaellig aber deterministisch — gleiche Punkte fuer gleiche IDs.
  const dots = [];
  for (let i = 0; i < count; i++) {
    const a = (i * 137.5) * (Math.PI / 180);
    const r = (0.35 + ((i * 13) % 100) / 200) * Math.min(rx, ry);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.7;
    dots.push({ x, y, r: 0.7 + (i % 3) * 0.4 });
  }
  return (
    <g>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#3a2a1a" opacity="0.7" />
      ))}
    </g>
  );
}

// ----- Einzelne Items -----

function Bunsen({ state }) {
  const on = state?.on;
  return (
    <g>
      {/* Brennerbasis (Fuss) */}
      <ellipse cx="35" cy="115" rx="30" ry="5" fill="#3a3a3a" />
      <path
        d="M18 115 L22 95 L48 95 L52 115 Z"
        fill="#4f4f4f"
        stroke="#2a2a2a"
        stroke-width="1"
        stroke-linejoin="round"
      />
      {/* Rohr */}
      <rect x="29" y="40" width="12" height="58" fill="#6b6b6b" stroke="#2a2a2a" stroke-width="1" rx="1" />
      {/* Luftring */}
      <rect x="27" y="60" width="16" height="7" fill="#8a8a8a" stroke="#2a2a2a" stroke-width="1" rx="1" />
      {/* Oeffnung oben */}
      <ellipse cx="35" cy="40" rx="6.5" ry="2.5" fill="#1a1a1a" />
      {/* Flamme wenn an */}
      {on && (
        <g className="lb-flame">
          <path
            d="M35 38 C 28 28, 26 18, 30 6 C 32 14, 36 14, 36 6 C 40 16, 44 24, 35 38 Z"
            fill="url(#lb-flame-grad)"
            opacity="0.92"
          />
          <path
            d="M35 36 C 31 30, 30 22, 33 14 C 34 19, 37 19, 37 14 C 39 22, 39 28, 35 36 Z"
            fill="#a5d6ff"
            opacity="0.85"
          />
        </g>
      )}
    </g>
  );
}

function Stand() {
  return (
    <g>
      {/* Schwerer Fuss */}
      <rect x="20" y="160" width="70" height="16" rx="2" fill="#3a3a3a" />
      <rect x="22" y="158" width="66" height="4" fill="#5a5a5a" />
      {/* Vertikale Stange */}
      <rect x="53" y="14" width="4" height="148" fill="#666" />
      {/* Klemmen-Arm horizontal */}
      <rect x="57" y="50" width="50" height="4" fill="#666" />
      {/* Klemmenbacken */}
      <path
        d="M105 38 Q 113 54, 105 70 M105 38 Q 100 54, 105 70"
        stroke="#444"
        stroke-width="3.5"
        fill="none"
        stroke-linecap="round"
      />
      {/* Klemmenschraube */}
      <circle cx="60" cy="52" r="3.5" fill="#888" stroke="#444" stroke-width="1" />
    </g>
  );
}

function RoundFlask({ state }) {
  const fill = state?.liquidColor;
  const contaminated = state?.contaminated;
  return (
    <g>
      {/* Hals */}
      <path d="M28 6 L28 38 L18 50 L52 50 L42 38 L42 6 Z" fill="#e8f4fa" stroke="#5b8dbf" stroke-width="1.6" stroke-linejoin="round" />
      {/* Bauchige Rundung */}
      <ellipse cx="35" cy="68" rx="30" ry="28" fill="#e8f4fa" stroke="#5b8dbf" stroke-width="1.6" />
      {/* Fluessigkeit */}
      {fill && (
        <>
          <path
            d="M9 70 A 30 28 0 0 0 61 70 L 61 78 A 30 28 0 0 1 9 78 Z"
            fill={fill}
            opacity="0.85"
          />
          {contaminated && <ContaminationDots cx={35} cy={74} rx={22} ry={8} count={16} />}
        </>
      )}
      {/* Glanz */}
      <path d="M14 60 Q 14 50, 25 46" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7" />
    </g>
  );
}

function ErlenmeyerFlask({ state }) {
  const fill = state?.liquidColor;
  const contaminated = state?.contaminated;
  const neck = state?.neck || 'straight';
  return (
    <g>
      {/* Hals — gerade oder Schwanenhals */}
      {neck === 'straight' ? (
        <rect x="29" y="6" width="12" height="22" fill="#e8f4fa" stroke="#5b8dbf" stroke-width="1.6" />
      ) : (
        <path
          d="M29 28 L29 16
             C 29 6, 50 8, 50 22
             C 50 38, 70 38, 70 22
             C 70 8, 88 8, 92 16
             L 96 12
             C 92 -2, 70 -2, 60 12
             C 50 26, 40 26, 40 10
             L 40 6 L 29 6 Z"
          fill="#e8f4fa"
          stroke="#5b8dbf"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      )}
      {/* Konisches Gefaess */}
      <path
        d="M29 28 L12 92 L58 92 L41 28 Z"
        fill="#e8f4fa"
        stroke="#5b8dbf"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      {/* Fluessigkeit */}
      {fill && (
        <>
          <path d="M19 72 L 12 92 L 58 92 L 51 72 Z" fill={fill} opacity="0.85" />
          {contaminated && <ContaminationDots cx={35} cy={82} rx={20} ry={9} count={18} />}
        </>
      )}
      {/* Glanz */}
      <line x1="22" y1="50" x2="18" y2="80" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.6" />
    </g>
  );
}

// Pasteur-Schwanenhalskolben. State:
//   neck: 'straight' | 'swan'   ('swan' nach Glasziehen mit Bunsen)
//   liquidColor: string?
//   tilted: boolean   (gekippt = Inhalt beruehrt Biegung)
function PasteurFlask({ state }) {
  const neck = state?.neck || 'straight';
  const fill = state?.liquidColor;
  return (
    <g>
      {/* Bauchige Rundung */}
      <ellipse cx="35" cy="110" rx="30" ry="28" fill="#e8f4fa" stroke="#5b8dbf" stroke-width="1.6" />
      {/* Hals — gerade oder gezogen */}
      {neck === 'straight' ? (
        <path
          d="M28 82 L28 12 L42 12 L42 82 Z"
          fill="#e8f4fa"
          stroke="#5b8dbf"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      ) : (
        <path
          d="M28 82 L28 50
             C 28 28, 50 32, 50 50
             C 50 70, 70 70, 70 50
             C 70 28, 86 28, 90 38
             L 96 32
             C 92 18, 70 18, 60 30
             C 50 42, 40 42, 38 28
             L 38 12 L 28 12 Z"
          fill="#e8f4fa"
          stroke="#5b8dbf"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      )}
      {/* Fluessigkeit */}
      {fill && (
        <>
          <path
            d="M9 110 A 30 28 0 0 0 61 110 L 61 120 A 30 28 0 0 1 9 120 Z"
            fill={fill}
            opacity="0.85"
          />
          {state?.contaminated && <ContaminationDots cx={35} cy={114} rx={22} ry={8} count={16} />}
        </>
      )}
      {/* Glanz */}
      <path d="M14 100 Q 14 90, 25 86" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7" />
    </g>
  );
}

function Tongs() {
  return (
    <g>
      {/* Pivot oben */}
      <circle cx="20" cy="10" r="4" fill="#5a5a5a" stroke="#2a2a2a" stroke-width="0.8" />
      {/* Linker Arm */}
      <path
        d="M 20 10 Q 14 30 8 80"
        fill="none"
        stroke="#8a8a8a"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      {/* Rechter Arm */}
      <path
        d="M 20 10 Q 26 30 32 80"
        fill="none"
        stroke="#8a8a8a"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      {/* Greifpads unten */}
      <circle cx="8" cy="80" r="4.5" fill="#5a5a5a" stroke="#2a2a2a" stroke-width="0.8" />
      <circle cx="32" cy="80" r="4.5" fill="#5a5a5a" stroke="#2a2a2a" stroke-width="0.8" />
      {/* Griff-Indikator (Spannungs-Schraube) */}
      <rect x="16" y="20" width="8" height="3" fill="#666" rx="1" />
    </g>
  );
}

function TestTube({ state }) {
  const fill = state?.liquidColor;
  return (
    <g>
      {/* Lippe oben */}
      <rect x="2" y="2" width="20" height="3" rx="1" fill="#5b8dbf" />
      {/* Tubus */}
      <path
        d="M3 5 L3 80 Q 12 92, 21 80 L 21 5 Z"
        fill="#e8f4fa"
        stroke="#5b8dbf"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      {fill && (
        <path
          d="M4 50 L 4 80 Q 12 92, 20 80 L 20 50 Z"
          fill={fill}
          opacity="0.85"
        />
      )}
      <line x1="7" y1="20" x2="6" y2="75" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.55" />
    </g>
  );
}

function ReagentBottle({ color, label }) {
  return (
    <g>
      {/* Deckel */}
      <rect x="16" y="2" width="18" height="8" rx="1.5" fill="#7d4a26" stroke="#3a1f10" stroke-width="1" />
      {/* Hals */}
      <rect x="18" y="10" width="14" height="6" fill="#e8f4fa" stroke="#5b8dbf" stroke-width="1.2" />
      {/* Body */}
      <path
        d="M8 16 L8 84 Q 8 88, 12 88 L 38 88 Q 42 88, 42 84 L 42 16 Z"
        fill="#e8f4fa"
        stroke="#5b8dbf"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      {/* Fluessigkeit */}
      <path
        d="M9 30 L 9 84 Q 9 87, 12 87 L 38 87 Q 41 87, 41 84 L 41 30 Z"
        fill={color}
        opacity="0.88"
      />
      {/* Label */}
      <rect x="11" y="42" width="28" height="22" fill="#fff" stroke="#5b8dbf" stroke-width="0.8" />
      <text
        x="25"
        y="56"
        text-anchor="middle"
        font-size="7"
        font-weight="700"
        font-family="ui-sans-serif, system-ui, sans-serif"
        fill="#3a3a3a"
      >
        {label}
      </text>
    </g>
  );
}

function PetriDish() {
  return (
    <g>
      <ellipse cx="30" cy="14" rx="28" ry="5" fill="#dfecf5" stroke="#5b8dbf" stroke-width="1.2" />
      <ellipse cx="30" cy="11" rx="28" ry="5" fill="#e8f4fa" stroke="#5b8dbf" stroke-width="1.2" />
    </g>
  );
}

function Beaker({ state }) {
  const fill = state?.liquidColor;
  return (
    <g>
      <path
        d="M8 6 L 12 6 L 12 12 L 48 12 L 48 6 L 52 6 L 52 70 Q 52 78, 44 78 L 16 78 Q 8 78, 8 70 Z"
        fill="#e8f4fa"
        stroke="#5b8dbf"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      {fill && (
        <path
          d="M9 44 L 51 44 L 51 70 Q 51 77, 44 77 L 16 77 Q 9 77, 9 70 Z"
          fill={fill}
          opacity="0.85"
        />
      )}
    </g>
  );
}

// Gemeinsame Defs (Verlaeufe etc.) — wird vom Bench einmal eingebunden.
export function LabBenchDefs() {
  return (
    <defs>
      <linearGradient id="lb-flame-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffe169" />
        <stop offset="55%" stop-color="#ff8b3d" />
        <stop offset="100%" stop-color="#d04525" />
      </linearGradient>
      <linearGradient id="lb-table" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#cbb593" />
        <stop offset="100%" stop-color="#8a6f4a" />
      </linearGradient>
      <linearGradient id="lb-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#dee8ee" />
        <stop offset="100%" stop-color="#b9c8d2" />
      </linearGradient>
      <linearGradient id="lb-fridge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#f8fafc" />
        <stop offset="50%" stop-color="#e8edf2" />
        <stop offset="100%" stop-color="#cfd6dc" />
      </linearGradient>
    </defs>
  );
}
