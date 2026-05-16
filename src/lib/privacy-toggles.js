/**
 * Single-Source-of-Truth fuer die Privacy-Toggles und die Effekt-Achsen,
 * die im InfoToggle-Popover (Tooltip) gerendert werden.
 *
 * Wird von der UI (`blogpost.astro` Privacy-Toolbox) UND vom Datenschutz-
 * Details-Tab (Phase 13) gelesen — beide zeigen die Beschreibungen und
 * Effekt-Checklisten so an, wie sie hier stehen.
 *
 * Effekt-Markierung pro Achse:
 *   '+'   = erlaubt
 *   '-'   = blockiert
 *    null = unveraendert (keine Wirkung)
 */

export const EFFECT_AXES = [
  { id: 'searchIndex',      label: 'Suchmaschinen-Index' },
  { id: 'aiCrawl',          label: 'AI-Crawler-Zugriff' },
  { id: 'socialPreview',    label: 'Social-Media-Preview' },
  { id: 'inHub',            label: 'Im Hub gelistet' },
  { id: 'inRss',            label: 'In RSS enthalten' },
  { id: 'inSitemap',        label: 'In Sitemap enthalten' },
  { id: 'urlGuessable',     label: 'URL ratbar' },
  { id: 'loginRequired',    label: 'Login noetig' },
  { id: 'tokenRequired',    label: 'Token noetig' },
  { id: 'passwordRequired', label: 'Passwort noetig' },
  { id: 'browserCache',     label: 'Browser-/CDN-Cache erlaubt' },
  { id: 'embedAllowed',     label: 'Embed/Iframe erlaubt' },
];

export const VISIBILITIES = [
  {
    id: 'public',
    label: 'Oeffentlich',
    short: 'Standard. Ueberall verlinkt, im Hub und auf der Startseite. Indexierbar fuer Suchmaschinen.',
    effects: {
      searchIndex: '+', aiCrawl: '+', socialPreview: '+',
      inHub: '+', inRss: '+', inSitemap: '+', urlGuessable: '+',
      browserCache: '+', embedAllowed: '+',
    },
  },
  {
    id: 'unlisted',
    label: 'Nicht gelistet',
    short: 'Nur per Direkt-URL erreichbar. Nicht im Hub, nicht in Sitemap/RSS, kein Suchindex. URL ist nicht ratbar (Slug).',
    effects: {
      searchIndex: '-', aiCrawl: '-', socialPreview: '-',
      inHub: '-', inRss: '-', inSitemap: '-', urlGuessable: '-',
    },
  },
  {
    id: 'private',
    label: 'Privat',
    short: 'Nur du siehst den Post (eingeloggt als Autor). Alle anderen bekommen 404 — die Existenz wird nicht verraten.',
    effects: {
      searchIndex: '-', aiCrawl: '-', socialPreview: '-',
      inHub: '-', inRss: '-', inSitemap: '-', urlGuessable: '-',
      loginRequired: '+',
    },
  },
  {
    id: 'password',
    label: 'Passwortgeschuetzt',
    short: 'Zugang nur mit dem von dir gesetzten Passwort (?pw=...) oder einem ausgegebenen Token (?key=...).',
    effects: {
      searchIndex: '-', aiCrawl: '-', socialPreview: '-',
      inHub: '-', inRss: '-', inSitemap: '-', urlGuessable: '-',
      passwordRequired: '+',
    },
  },
];

export const TOGGLES = [
  {
    id: 'noindex',
    label: 'Suchindex aus',
    short: 'Sendet noindex/nofollow als Meta + X-Robots-Tag. Kompliante Suchmaschinen indexieren den Post nicht.',
    effects: { searchIndex: '-', inSitemap: '-' },
  },
  {
    id: 'noai_meta',
    label: 'KI-Meta',
    short: 'Meta-Signale (noai, tdm-reservation, ai-content-declaration). Bittet KI-Crawler hoeflich, den Post nicht ins Training zu nehmen — viele respektieren es nicht.',
    effects: { aiCrawl: '-' },
  },
  {
    id: 'noai_ua_gate',
    label: 'KI-Block (hart)',
    short: 'Bekannte KI-Bots bekommen 403 auf Serverebene — wirkt auch bei Bots, die das Meta ignorieren. Greift NICHT gegen UA-Faelscher; dafuer braucht es Token/Login.',
    effects: { aiCrawl: '-' },
  },
  {
    id: 'no_archive',
    label: 'Archiv-Sperre',
    short: 'Verhindert Caching/Wayback-Snapshots ueber X-Archive-Disallow + no-store/no-archive Cache-Control.',
    effects: { browserCache: '-' },
  },
  {
    id: 'no_referrer',
    label: 'Referrer-Sperre',
    short: 'Externe Links im Post kriegen rel=nofollow noreferrer noopener und Browser senden den Referer nicht. Schuetzt, dass deine Post-URL ueber Drittseiten leakt.',
    effects: {},
  },
  {
    id: 'no_embed',
    label: 'Embed-Sperre',
    short: 'Niemand kann den Post in iframe/Embed einbetten (frame-ancestors none).',
    effects: { embedAllowed: '-' },
  },
  {
    id: 'watermark',
    label: 'Wasserzeichen',
    short: 'Halb-transparenter Username+Datum-Stempel ueber dem Text. Macht Screenshots rueckverfolgbar, ist aber kein echter Schutz.',
    effects: {},
  },
  {
    id: 'soft_select',
    label: 'Select-Sperre',
    short: 'CSS user-select=none + Rechtsklick-Verbot + Copy-Cancel. Kein echter Schutz — nur weiches Hindernis. Bricht Accessibility (Screenreader-Probleme).',
    effects: {},
  },
  {
    id: 'js_only',
    label: 'JS-only-Render',
    short: 'Server liefert leeres Skelett, Inhalt wird per fetch nachgeladen. Bricht jeden klassischen Crawler — auch Suchindex. Nur fuer voll versteckte Inhalte.',
    effects: { searchIndex: '-', inSitemap: '-' },
  },
];

/**
 * Berechnet pro Achse den aggregierten Effekt einer Visibility-Stufe
 * plus Toggle-Set. Convention: spaeterer Wert ueberschreibt frueheren,
 * '-' hat immer Vorrang vor '+' (block trumpft allow).
 */
export function aggregateEffects(visibilityId, flags) {
  const result = {};
  const v = VISIBILITIES.find((x) => x.id === visibilityId) || VISIBILITIES[0];
  for (const [k, val] of Object.entries(v.effects)) {
    result[k] = val;
  }
  for (const t of TOGGLES) {
    if (!flags || flags[t.id] !== true) continue;
    for (const [k, val] of Object.entries(t.effects)) {
      if (val == null) continue;
      if (val === '-' || result[k] == null) result[k] = val;
    }
  }
  return result;
}
