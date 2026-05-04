/**
 * rpg-lock-icon.jsx — gemeinsame Quelle fuer das Lock-Symbol des Tree-Lock-Tools.
 * (Umbenannt 2026-05-04 von .js auf .jsx, weil die Datei eine JSX-Komponente
 *  exportiert und Astro/Vite das in .js nicht parsen konnte.)
 *
 * Wird von zwei Stellen konsumiert:
 *   1) `RpgAstrolab.jsx` — rendert das Bead-Icon im Wheel (statt Emoji-Text).
 *   2) `RpgQuestTree.jsx` — setzt den Cursor im Lock-Modus via inline-Style
 *      (CSS-Custom-Property `--rpg-lock-cursor`).
 *
 * Design (Stand 2026-05-03)
 * ─────────────────────────
 * Drei-Schicht-"Coin"-Optik passend zum Astrolab-Theme:
 *   1) Aeussere Goldschicht (Glow/Halo) — breite, weiche Kontur
 *   2) Mittlere Schwarzschicht — duenner schwarzer Frame, klare Lesbarkeit
 *   3) Innere Goldfuellung — Gold gefuellte Mitte (nur Body, nicht Buegel)
 *
 * Wenn das Symbol angepasst wird: NUR diese Datei aendern — Astrolab und
 * Cursor folgen automatisch, weil beide aus denselben Konstanten gespeist werden.
 */

// --- SVG-Geometrie (viewBox 0..24, kanonisch) ---

const PATH_D = 'M8 11V8a4 4 0 0 1 8 0v3'; // Bügel-Bogen
const RECT_OUTER = { x: 4, y: 10, w: 16, h: 12, rx: 2.5 };  // gold-Halo
const RECT_MIDDLE = { x: 5, y: 11, w: 14, h: 10, rx: 2 };   // schwarzer Frame
const RECT_INNER = { x: 6, y: 12, w: 12, h: 8, rx: 1.5 };   // gold-Fuellung

// Stroke-Breiten der drei Schichten
const STROKE_GOLD_OUTER = 1.6; // schmal — der Halo wirkt durch fill, nicht stroke
const STROKE_BLACK = 1.4;
const STROKE_GOLD_INNER_RING = 0.8;

// Farben (kanonisch fuer Astrolab-Theme)
const GOLD = '#fbe6a0';
const BLACK = '#1a140c'; // Schwarzbraun statt reinem Schwarz — passt besser zum Messing-Theme

// --- JSX-Komponente fuer Astrolab-Bead ---

/**
 * Inline-SVG-Komponente fuer das Astrolab-Bead.
 *
 * Wird als nested SVG in das Astrolab-SVG eingehaengt — dadurch ist die
 * lokale viewBox 0..24 und wir koennen das Icon einfach via `size` skalieren
 * ohne externes transform/scale.
 *
 * Schichten (von hinten nach vorne):
 *   - Outer rect: goldener Rand (Halo)
 *   - Buegel-Path: gold dick als Glow → schwarz duenner darueber
 *   - Middle rect: schwarzer Frame (transparent gefuellt)
 *   - Inner rect: goldene Mitte (NUR bei variant 'solid')
 *
 * @param {{ x: number; y: number; size: number; variant?: 'solid' | 'outline' }} props
 * - x/y: Mittelpunkt im Eltern-Koordinatensystem
 * - size: Kantenlaenge in Eltern-Pixeln
 * - variant:
 *     'solid' (Default) — voll gefuellt mit Gold innen. Optisch dichter,
 *       gut lesbar bei kleinen Groessen → fuer den CSS-Cursor passend.
 *     'outline' — Gold-Aussenrand + schwarzer Frame, INNEN transparent
 *       (kein gold-fill, kein Inner-Akzent-Ring). Fuer das Astrolab-Bead:
 *       der goldene Bead-Hintergrund schimmert durch das transparente
 *       Schloss-Innere durch — wirkt eleganter im Wheel.
 */
export function LockGlyphSvg({ x, y, size, variant = 'solid' }) {
  const half = size / 2;
  const isSolid = variant !== 'outline';
  return (
    <svg
      x={x - half}
      y={y - half}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      overflow="visible"
      style={{ pointerEvents: 'none' }}
    >
      {/* Schicht 1: goldener Aussenrand. Im 'solid'-Modus voll gefuellt
          (Halo-Effekt fuer den Cursor); im 'outline'-Modus nur Stroke,
          damit der Astrolab-Bead-Hintergrund durchschimmert. */}
      <rect
        x={RECT_OUTER.x} y={RECT_OUTER.y} width={RECT_OUTER.w} height={RECT_OUTER.h}
        rx={RECT_OUTER.rx}
        fill={isSolid ? GOLD : 'none'}
        stroke={GOLD}
        stroke-width={isSolid ? STROKE_GOLD_OUTER : 1.4}
      />

      {/* Buegel: erst gold (dick als Glow-Halo), dann schwarz schmaler darueber */}
      <path
        d={PATH_D}
        fill="none"
        stroke={GOLD}
        stroke-width={3}
        stroke-linecap="round"
      />
      <path
        d={PATH_D}
        fill="none"
        stroke={BLACK}
        stroke-width={STROKE_BLACK}
        stroke-linecap="round"
      />

      {/* Schicht 2: schwarzer Frame um den Body */}
      <rect
        x={RECT_MIDDLE.x} y={RECT_MIDDLE.y} width={RECT_MIDDLE.w} height={RECT_MIDDLE.h}
        rx={RECT_MIDDLE.rx}
        fill="none"
        stroke={BLACK}
        stroke-width={STROKE_BLACK}
      />

      {/* Schicht 3 + Akzent: goldene Innenfuellung. NUR im 'solid'-Modus —
          'outline' laesst den Innenraum transparent, damit man durch das
          Schloss auf den Bead-Hintergrund schaut. */}
      {isSolid ? (
        <>
          <rect
            x={RECT_INNER.x} y={RECT_INNER.y} width={RECT_INNER.w} height={RECT_INNER.h}
            rx={RECT_INNER.rx}
            fill={GOLD}
            stroke="none"
          />
          <rect
            x={RECT_INNER.x + 0.6} y={RECT_INNER.y + 0.6}
            width={RECT_INNER.w - 1.2} height={RECT_INNER.h - 1.2}
            rx={Math.max(0, RECT_INNER.rx - 0.4)}
            fill="none"
            stroke={GOLD}
            stroke-width={STROKE_GOLD_INNER_RING}
            opacity="0.7"
          />
        </>
      ) : null}
    </svg>
  );
}

// --- CSS-Cursor (Daten-URI, dasselbe Symbol) ---

/*
 * Wir bauen das gleiche dreischichtige SVG als data-URI fuer den Cursor.
 * URL-encodet sind nur Zeichen, die in CSS-`url(...)`-Strings problematisch
 * sind: `#` (Anker), Newlines, einige Zeichen wie `<` `>` werden in modernen
 * Browsern via utf8-Variante akzeptiert, aber wir encoden defensiv.
 */
function rectSvg(r, fill, stroke, sw) {
  const fillAttr = fill ? `fill='${fill}'` : `fill='none'`;
  const strokeAttr = stroke ? ` stroke='${stroke}' stroke-width='${sw}'` : '';
  return `<rect x='${r.x}' y='${r.y}' width='${r.w}' height='${r.h}' rx='${r.rx}' ${fillAttr}${strokeAttr}/>`;
}

// Farben fuer den Cursor — `#` muss in der Daten-URI als `%23` encoded werden.
const GOLD_URL = '%23fbe6a0';
const BLACK_URL = '%231a140c';

const LOCK_SVG_DATA = (
  `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24'>`
  + rectSvg(RECT_OUTER, GOLD_URL, GOLD_URL, STROKE_GOLD_OUTER)
  + `<path d='${PATH_D}' fill='none' stroke='${GOLD_URL}' stroke-width='3' stroke-linecap='round'/>`
  + `<path d='${PATH_D}' fill='none' stroke='${BLACK_URL}' stroke-width='${STROKE_BLACK}' stroke-linecap='round'/>`
  + rectSvg(RECT_MIDDLE, null, BLACK_URL, STROKE_BLACK)
  + rectSvg(RECT_INNER, GOLD_URL, null, 0)
  + `</svg>`
);

/**
 * Kompletter `cursor`-Property-Wert inkl. Hot-Spot und Fallback.
 *
 * Verwendung im JSX (CSS-Custom-Property):
 *   <div style={{ '--rpg-lock-cursor': LOCK_CURSOR_VALUE }}>...
 * Im CSS:
 *   .rpg-tree--tool-lock { cursor: var(--rpg-lock-cursor, pointer); }
 *
 * Hot-Spot 14 14 entspricht Mittelpunkt des 28x28-Cursors.
 */
export const LOCK_CURSOR_VALUE = `url("data:image/svg+xml;utf8,${LOCK_SVG_DATA}") 14 14, pointer`;
