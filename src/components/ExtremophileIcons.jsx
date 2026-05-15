// Simple Icons fuer das Extremophile-Minigame.
// Bewusst grob angedeutet — Hauptzweck ist visuelle Wiedererkennung.

export function ExtremophileIcon({ iconKey, size = 96 }) {
  switch (iconKey) {
    case 'flame':
      return <Flame size={size} />;
    case 'snowflake':
      return <Snowflake size={size} />;
    case 'acid':
      return <Acid size={size} />;
    case 'alkali':
      return <Alkali size={size} />;
    case 'pressure':
      return <Pressure size={size} />;
    case 'salt':
      return <Salt size={size} />;
    default:
      return null;
  }
}

function Flame({ size }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path
        d="M32 6 C 38 16, 48 22, 46 36 C 46 50, 40 58, 32 58 C 24 58, 18 50, 18 36 C 18 28, 24 22, 26 18 Q 28 24, 30 18 Q 32 12, 32 6 Z"
        fill="rgba(225, 80, 50, 0.18)"
        stroke="#c8412a"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <path
        d="M32 22 C 35 28, 39 32, 38 42 C 38 50, 35 54, 32 54 C 29 54, 26 50, 26 42 C 26 36, 30 32, 32 22 Z"
        fill="rgba(255, 170, 60, 0.45)"
        stroke="#dd932a"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M32 36 C 33 39, 35 41, 34 46 C 34 49, 33 51, 32 51 C 31 51, 30 49, 30 46 C 30 43, 31 41, 32 36 Z"
        fill="#ffe27a"
        stroke="none"
      />
    </svg>
  );
}

function Snowflake({ size }) {
  const arms = [0, 60, 120];
  return (
    <svg viewBox="-32 -32 64 64" width={size} height={size} aria-hidden="true">
      <g
        stroke="#3a6ea8"
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      >
        {arms.map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <line x1="0" y1="-28" x2="0" y2="28" />
            <line x1="0" y1="-28" x2="-5" y2="-22" />
            <line x1="0" y1="-28" x2="5" y2="-22" />
            <line x1="0" y1="28" x2="-5" y2="22" />
            <line x1="0" y1="28" x2="5" y2="22" />
            <line x1="0" y1="-16" x2="-4" y2="-12" />
            <line x1="0" y1="-16" x2="4" y2="-12" />
            <line x1="0" y1="16" x2="-4" y2="12" />
            <line x1="0" y1="16" x2="4" y2="12" />
          </g>
        ))}
        <circle cx="0" cy="0" r="2.5" fill="#3a6ea8" stroke="none" />
      </g>
    </svg>
  );
}

function Acid({ size }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path
        d="M32 6 C 38 18, 50 30, 50 42 C 50 53, 42 58, 32 58 C 22 58, 14 53, 14 42 C 14 30, 26 18, 32 6 Z"
        fill="rgba(220, 100, 60, 0.18)"
        stroke="#c43a0e"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <text
        x="32"
        y="48"
        text-anchor="middle"
        font-size="18"
        font-weight="800"
        fill="#c43a0e"
        font-family="ui-sans-serif, system-ui, sans-serif"
      >
        H⁺
      </text>
    </svg>
  );
}

function Alkali({ size }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path
        d="M32 6 C 38 18, 50 30, 50 42 C 50 53, 42 58, 32 58 C 22 58, 14 53, 14 42 C 14 30, 26 18, 32 6 Z"
        fill="rgba(110, 150, 220, 0.18)"
        stroke="#2b5fa6"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <text
        x="32"
        y="48"
        text-anchor="middle"
        font-size="14"
        font-weight="800"
        fill="#2b5fa6"
        font-family="ui-sans-serif, system-ui, sans-serif"
      >
        OH⁻
      </text>
    </svg>
  );
}

function Pressure({ size }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <polygon points="32,4 24,14 40,14" fill="#4b4b4b" stroke="none" />
      <line x1="32" y1="14" x2="32" y2="22" stroke="#4b4b4b" stroke-width="2" stroke-linecap="round" />
      <polygon points="32,60 24,50 40,50" fill="#4b4b4b" stroke="none" />
      <line x1="32" y1="50" x2="32" y2="42" stroke="#4b4b4b" stroke-width="2" stroke-linecap="round" />
      <rect
        x="12"
        y="22"
        width="40"
        height="20"
        rx="3"
        fill="rgba(70, 70, 70, 0.16)"
        stroke="#4b4b4b"
        stroke-width="2"
      />
      <line x1="20" y1="28" x2="44" y2="28" stroke="#4b4b4b" stroke-width="1.4" stroke-linecap="round" opacity="0.55" />
      <line x1="20" y1="34" x2="44" y2="34" stroke="#4b4b4b" stroke-width="1.4" stroke-linecap="round" opacity="0.55" />
    </svg>
  );
}

function Salt({ size }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g fill="rgba(220, 200, 160, 0.55)" stroke="#9c7c30" stroke-width="1.6" stroke-linejoin="round">
        <polygon points="14,28 22,22 30,28 22,34" />
        <polygon points="22,34 22,44 14,38 14,28" />
        <polygon points="22,34 30,28 30,38 22,44" />
        <polygon points="34,18 44,14 50,18 40,22" />
        <polygon points="40,22 40,30 34,26 34,18" />
        <polygon points="40,22 50,18 50,26 40,30" />
        <polygon points="28,42 38,38 44,42 34,46" />
        <polygon points="34,46 34,54 28,50 28,42" />
        <polygon points="34,46 44,42 44,50 34,54" />
      </g>
      <text
        x="32"
        y="62"
        text-anchor="middle"
        font-size="9"
        font-weight="800"
        fill="#876a30"
        font-family="ui-sans-serif, system-ui, sans-serif"
      >
        NaCl
      </text>
    </svg>
  );
}
