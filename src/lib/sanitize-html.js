/**
 * Server-seitiger HTML-Sanitizer fuer Blog-Post-Inhalte (K1).
 *
 * Quelle: `document.execCommand` im Editor liefert beliebiges HTML, das
 * der User durch Paste oder manuelle Manipulation steuern kann. Vor dem
 * Speichern + bei jeder Anzeige laufen wir das durch isomorphic-dompurify
 * mit einer engen Allow-List.
 *
 * Erlaubt sind die Tags + Attribute, die der Editor + die Format-Werkzeuge
 * tatsaechlich produzieren — alles drueber hinaus wird stillschweigend
 * entfernt. Insbesondere `<script>`, `on*`-Handler, `javascript:`-URLs,
 * `<iframe>`/`<object>`/`<embed>` sind blockiert.
 */

import DOMPurify from 'isomorphic-dompurify';

// Tags, die der Editor je erzeugt + harmloses Strukturmarkup.
const ALLOWED_TAGS = [
  'p', 'br', 'span', 'div',
  'b', 'strong', 'i', 'em', 'u', 's',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'blockquote', 'pre', 'code',
  'hr',
  // `<font face=…>` wird von document.execCommand('fontName', …) erzeugt.
  // Wir lassen es zu, beschraenken aber die Attribute.
  'font',
];

// Erlaubte Attribute. Alles andere wird weggeworfen.
const ALLOWED_ATTR = [
  'href', 'title', 'class', 'lang', 'dir',
  'face', 'color',
  // Editor setzt style="color:…" ueber execCommand('foreColor').
  'style',
];

// Allowed URI-Schemes — explizit ohne `javascript:` und `data:` (bei <a>).
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOWED_URI_REGEXP,
  // Forbid auch wenn jemand sie ueber Sub-Konfig wieder reintricksen wollte.
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'style', 'svg', 'math'],
  FORBID_ATTR: [
    'srcdoc', 'sandbox', 'formaction',
    // alle on*-Handler werden ueber das Allow-Set ohnehin gestrippt;
    // wir nennen die haeufigsten zusaetzlich explizit, falls jemand das
    // Default-Profil aushebelt.
    'onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onmouseenter',
  ],
  // Saubere innerHTML — kein Wrap mit <html><body>.
  WHOLE_DOCUMENT: false,
  RETURN_TRUSTED_TYPE: false,
};

/**
 * Sanitisiert HTML fuer Blog-Post-Inhalt. Liefert immer einen String
 * zurueck — leerer String wenn Input leer/ungueltig.
 */
export function sanitizePostHtml(html) {
  const input = typeof html === 'string' ? html : '';
  if (!input) return '';
  return DOMPurify.sanitize(input, PURIFY_CONFIG);
}
