/**
 * Server-seitiger HTML-Sanitizer fuer Blog-Post-Inhalte (K1).
 *
 * Quelle: `document.execCommand` im Editor liefert beliebiges HTML, das der
 * User durch Paste oder manuelle Manipulation steuern kann. Vor dem Speichern
 * + bei jeder Anzeige laufen wir das durch eine enge Allow-List.
 *
 * Frueher via `isomorphic-dompurify` (zieht jsdom). jsdom@29 -> html-encoding-
 * sniffer@6 macht `require()` auf das ESM-only `@exodus/bytes` — das wirft auf
 * Vercels Function-Runtime (Node < 22.12) `ERR_REQUIRE_ESM` schon beim
 * Modul-Load, womit JEDE Route, die diese Datei importiert, mit leerem 500
 * crasht (Posten + Post-Anzeige). Deshalb jetzt das pure-JS-Paket
 * `sanitize-html` (htmlparser2-basiert, kein DOM, keine ESM/Node-Stolperfalle).
 *
 * Erlaubt sind die Tags + Attribute, die der Editor + die Format-Werkzeuge
 * tatsaechlich produzieren — alles drueber hinaus wird entfernt. Insbesondere
 * `<script>`, `on*`-Handler, `javascript:`-URLs, `<iframe>`/`<object>`/
 * `<embed>` sind blockiert.
 */

import sanitizeHtml from 'sanitize-html';

// Tags, die der Editor je erzeugt + harmloses Strukturmarkup.
// `<font face=…>` kommt von document.execCommand('fontName', …).
const ALLOWED_TAGS = [
  'p', 'br', 'span', 'div',
  'b', 'strong', 'i', 'em', 'u', 's',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'blockquote', 'pre', 'code',
  'hr', 'font',
];

// Erlaubte Farb-Werte fuer inline `style="color: …"` (vom Editor via
// execCommand('foreColor')). Nur Hex, rgb()/rgba() oder ein einfacher
// CSS-Farbname — KEIN url(), expression(), var(), Quotes etc. (matchen die
// Regexe nicht und werden damit verworfen).
const SAFE_COLOR = [
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
  /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i,
  /^[a-zA-Z]+$/,
];

const CONFIG = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'class', 'lang', 'dir', 'style'],
    font: ['face', 'color', 'title', 'class', 'lang', 'dir', 'style'],
    '*': ['title', 'class', 'lang', 'dir', 'style'],
  },
  // Nur `color` als inline-Style zulassen, und nur mit sicheren Werten.
  allowedStyles: {
    '*': { color: SAFE_COLOR },
  },
  // URL-Schemes: http(s)/mailto/tel + schemenlose (relative/#) URLs erlaubt;
  // javascript:, data: etc. fliegen raus. Keine protokoll-relativen //host.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Gefaehrliche Tags samt Inhalt verwerfen (nicht nur das Tag strippen und
  // den Text stehen lassen).
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'form'],
  disallowedTagsMode: 'discard',
};

/**
 * Sanitisiert HTML fuer Blog-Post-Inhalt. Liefert immer einen String zurueck
 * — leerer String wenn Input leer/ungueltig.
 */
export function sanitizePostHtml(html) {
  const input = typeof html === 'string' ? html : '';
  if (!input) return '';
  return sanitizeHtml(input, CONFIG);
}
