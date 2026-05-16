/**
 * Erzeugt einen nicht-ratbaren Slug fuer oeffentliche Post-URLs (B13).
 *
 * 12 Hex-Zeichen aus `crypto.randomUUID()` = 48 Bit Entropie. Damit ist
 * eine zufaellige Kollision oder gar systematisches Raten zwischen den
 * Posts dieser Seite ausgeschlossen — wir nutzen das vor allem fuer
 * `unlisted` Posts (URL muss bekannt sein, aber nicht hochzaehlbar).
 *
 * Single-Source-of-Truth fuer Slug-Format. Wenn sich Laenge/Alphabet
 * je aendert, hier zentral umstellen.
 */
export function makePublicSlug() {
  const uuid = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(16) + Math.random().toString(16).slice(2);
  return uuid.replace(/-/g, '').slice(0, 12).toLowerCase();
}

export function isValidPublicSlug(value) {
  return typeof value === 'string' && /^[0-9a-f]{12}$/.test(value);
}

const ALLOWED_VISIBILITIES = new Set(['public', 'unlisted', 'private', 'password']);

export function normalizeVisibility(value) {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_VISIBILITIES.has(v) ? v : 'public';
}

export function isListableVisibility(value) {
  return normalizeVisibility(value) === 'public';
}

/**
 * Parsed das gespeicherte JSON-Bag der Toggles. Tolerant gegen Muell —
 * wer hier kaputten Input liefert, kriegt {} zurueck (keine Toggles).
 */
export function parsePrivacyFlags(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

/**
 * Visibility erzwingt bestimmte Privacy-Direktiven (auch ohne dass der User
 * die Toggles einzeln setzt). Logik: alles, was nicht `public` ist, soll
 * **nicht** indexiert/trainiert/archiviert werden — sonst landen unlisted
 * Posts versehentlich im Google-Index.
 *
 * Die Felder im Ergebnis sind reine Effekt-Booleans, die meta-tags() und
 * privacyHeaders() lesen.
 */
export function computeEffectivePrivacy({ visibility, privacyFlags } = {}) {
  const v = normalizeVisibility(visibility);
  const flags = parsePrivacyFlags(privacyFlags);
  const enforced = v !== 'public';
  return {
    visibility: v,
    noindex: enforced || flags.noindex === true,
    noai: enforced || flags.noai_meta === true,
    noArchive: enforced || flags.no_archive === true,
    noReferrer: flags.no_referrer === true,
    noEmbed: flags.no_embed === true,
    // B4 UA-Gate ist ein Opt-in, separat vom Meta-noai. Wenn der User
    // den UA-Gate aktiviert, blocken wir KI- und Archive-Bots auf
    // Serverebene (403 statt Inhalt). Suchmaschinen-Bots werden nicht
    // automatisch geblockt — die respektieren typischerweise das Meta.
    uaGateBlock: new Set(
      (enforced || flags.noai_ua_gate === true) ? ['ai', 'archive'] : []
    ),
    // B19 / B18 / B21 — kleine UI-Helfer, werden im Detail-Pfad
    // ausgewertet und an die Render-Logik gegeben.
    watermark: flags.watermark === true,
    softSelect: flags.soft_select === true,
    jsOnly: flags.js_only === true,
  };
}

/**
 * Liefert die `<meta>`-Tag-Definitionen, die im `<head>` einer Post-Seite
 * stehen sollen. Format: `{ name, content }` — der Caller rendert das
 * 1:1 in JSX/Astro.
 */
export function privacyMetaTags(effective) {
  const tags = [];
  const robots = [];
  const aiRobots = [];

  if (effective.noindex) {
    robots.push('noindex', 'nofollow', 'noarchive', 'nosnippet', 'noimageindex');
  }
  if (effective.noai) {
    aiRobots.push('noai', 'noimageai');
  }
  if (robots.length || aiRobots.length) {
    tags.push({ name: 'robots', content: [...robots, ...aiRobots].join(', ') });
  }
  if (effective.noai) {
    tags.push({ name: 'ai-content-declaration', content: 'opt-out' });
    tags.push({ name: 'tdm-reservation', content: '1' });
  }
  if (effective.noArchive) {
    tags.push({ name: 'archive', content: 'off' });
  }
  if (effective.noReferrer) {
    tags.push({ name: 'referrer', content: 'no-referrer' });
  }
  return tags;
}

/**
 * Liefert die HTTP-Header-Werte, die die Post-Response zusaetzlich setzen
 * soll. Aufrufer setzt sie ueber Astro.response.headers.set(name, value).
 *
 * Hart auf Server-Ebene durchgesetzte Direktiven:
 * - X-Robots-Tag entspricht den Meta-Tags, gilt aber auch fuer Crawler,
 *   die das HTML gar nicht parsen (z. B. Header-only Bots).
 * - Cache-Control no-store/no-archive verhindert Wayback-Snapshots.
 * - frame-ancestors / X-Frame-Options blockiert Iframe-Embeds.
 * - Referrer-Policy ist das authoritative Pendant zum referrer-meta.
 */
export function privacyHeaders(effective) {
  const headers = {};
  const robots = [];
  if (effective.noindex) {
    robots.push('noindex', 'nofollow', 'noarchive', 'nosnippet');
  }
  if (effective.noai) {
    robots.push('noai', 'noimageai');
  }
  if (robots.length) {
    headers['X-Robots-Tag'] = robots.join(', ');
  }
  if (effective.noai) {
    headers['tdm-reservation'] = '1';
  }
  if (effective.noArchive) {
    headers['Cache-Control'] = 'no-store, no-archive, max-age=0';
    headers['X-Archive-Disallow'] = '1';
  }
  if (effective.noReferrer) {
    headers['Referrer-Policy'] = 'no-referrer';
  }
  if (effective.noEmbed) {
    headers['Content-Security-Policy'] = "frame-ancestors 'none'";
    headers['X-Frame-Options'] = 'DENY';
  }
  return headers;
}

/**
 * Transformiert Post-HTML so, dass *externe* `<a href>`-Links ein
 * konservatives `rel="nofollow noreferrer noopener"` bekommen. Interne
 * Links (gleicher Host oder relativ) bleiben unangetastet.
 *
 * Sehr bewusst per Regex und nicht per echtem HTML-Parser: das gespeicherte
 * Markup stammt aus `document.execCommand` (Editor), ist trivial flach und
 * verdient kein eigenes Parser-Setup. Wenn das Markup spaeter komplexer
 * wird, ist das hier die zentrale Stelle zum Aufruesten.
 */
export function rewriteOutboundLinks(html, { siteHost = '' } = {}) {
  if (typeof html !== 'string' || !html) return String(html || '');
  const wanted = 'nofollow noreferrer noopener';
  return html.replace(/<a\b([^>]*?)\bhref\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>/gi, (match, before, _q, hrefDouble, hrefSingle, after) => {
    const href = String(hrefDouble || hrefSingle || '').trim();
    if (!/^https?:\/\//i.test(href)) return match; // relativ → intern, lassen
    if (siteHost) {
      try {
        const u = new URL(href);
        if (u.host === siteHost) return match; // gleicher Host → intern, lassen
      } catch {}
    }
    const attrs = `${before} ${after}`;
    const existingRel = attrs.match(/\brel\s*=\s*("([^"]*)"|'([^']*)')/i);
    let newRel = wanted;
    if (existingRel) {
      const oldVal = String(existingRel[2] || existingRel[3] || '').toLowerCase();
      const have = new Set(oldVal.split(/\s+/).filter(Boolean));
      for (const r of wanted.split(' ')) have.add(r);
      newRel = Array.from(have).join(' ');
      const withoutRel = attrs.replace(/\s*\brel\s*=\s*("[^"]*"|'[^']*')/i, '');
      return `<a${withoutRel} href="${href.replace(/"/g, '&quot;')}" rel="${newRel}">`;
    }
    return `<a${attrs} href="${href.replace(/"/g, '&quot;')}" rel="${newRel}">`;
  });
}
