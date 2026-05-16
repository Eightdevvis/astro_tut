/**
 * Single-Source-of-Truth fuer den Datenschutz-Details-Tab.
 *
 * Pflichtfeld pro DB-Tabelle: { table, category, purpose, retention,
 * accessRoles, fields }
 *
 * Optional: { permissionsAnyOf: [...] }
 *   - Wenn gesetzt: der Eintrag wird im Datenschutz-Tab nur User
 *     angezeigt, die mindestens eines dieser Rechte haben.
 *   - Superuser (`super_access`) sieht alle Eintraege grundsaetzlich.
 *   - Ohne `permissionsAnyOf` (oder leeres Array) → fuer alle sichtbar.
 *
 * `category` einer von:
 *   - 'auth'         — Anmeldung, Berechtigungen
 *   - 'content'      — User-erzeugte Inhalte
 *   - 'behavior'     — Verhalten / Spiel-Fortschritt / Logs
 *   - 'tester'       — interne Test-Tools mit User-Submission
 *   - 'network'      — Server-seitiges Logging
 *   - 'global'       — site-weite Konfiguration ohne direkten User-Bezug
 *
 * **Pflege-Pflicht**: jede neue DB-Tabelle MUSS hier auftauchen, sonst
 * schlaegt `tests/data-inventory.test.js` rot.
 */

export const DATA_INVENTORY = [
  // === auth ===
  {
    table: 'users',
    category: 'auth',
    purpose: 'Anmeldedaten (Username, bcrypt-Hash, Geburtsdatum).',
    retention: 'solange Account besteht',
    accessRoles: ['owner', 'superuser'],
    fields: ['id', 'username', 'birthday', 'password (bcrypt)', 'display_name'],
  },
  {
    table: 'user_permissions',
    category: 'auth',
    purpose: 'Pro-User-Rechte (z. B. blogpost_poster, rpg_access).',
    retention: 'solange Account besteht',
    accessRoles: ['owner', 'superuser'],
    fields: ['username', 'permission', 'state'],
  },
  {
    table: 'global_permissions',
    category: 'auth',
    purpose: 'Globale Default-Rechte fuer alle User.',
    retention: 'unbegrenzt',
    accessRoles: ['superuser'],
    fields: ['permission'],
  },
  {
    table: 'permission_warnings',
    category: 'auth',
    purpose: 'Hinweistexte zu sensiblen Rechten.',
    retention: 'unbegrenzt',
    accessRoles: ['superuser'],
    fields: ['permission', 'message'],
  },

  // === content ===
  {
    table: 'quotes',
    category: 'content',
    purpose: 'Eingereichte Zitate.',
    retention: 'unbegrenzt; Loeschung auf Anfrage',
    accessRoles: ['owner', 'superuser'],
    fields: ['id', 'username', 'text', 'author', 'created_at'],
    permissionsAnyOf: ['quote_poster'],
  },
  {
    table: 'user_vocab_cards',
    category: 'content',
    purpose: 'Persoenliche Vokabelkarten (Wort/Lautschrift/Definition), Anzeige auf /me.',
    retention: 'unbegrenzt; vom Owner jederzeit loeschbar',
    accessRoles: ['owner'],
    fields: ['id', 'username', 'word', 'pronunciation', 'definition', 'created_at', 'updated_at'],
  },
  {
    table: 'blog_posts',
    category: 'content',
    purpose: 'Deine Blog-Posts inkl. Privacy-Einstellungen und Tokens.',
    retention: 'unbegrenzt aktiv; soft-deleted 30 Tage im Papierkorb, dann hart geloescht',
    accessRoles: ['owner', 'superuser', 'gemaess Visibility/Token/Passwort'],
    fields: [
      'id', 'username', 'content_html', 'content_text', 'accent_color',
      'doodle_data_url', 'created_at', 'deleted_at', 'public_slug',
      'visibility', 'privacy_flags', 'password_hash (bcrypt)', 'expires_at',
    ],
    permissionsAnyOf: ['blogpost_poster'],
  },
  {
    table: 'blog_post_revisions',
    category: 'content',
    purpose: 'Versionshistorie: vor jedem Save wird der alte Stand gespeichert (A3).',
    retention: 'pro Post limitiert; alte Revisionen werden verdichtet',
    accessRoles: ['owner', 'superuser'],
    fields: ['id', 'post_id', 'username', 'content_html', 'content_text', 'accent_color', 'doodle_data_url', 'privacy_flags', 'change_reason', 'created_at'],
    permissionsAnyOf: ['blogpost_poster'],
  },
  {
    table: 'blog_post_drafts',
    category: 'content',
    purpose: 'Auto-Save-Drafts pro (User, Post). Ein Slot pro Post (0 = neuer Post).',
    retention: 'ueberschrieben oder bis erfolgreichem Save',
    accessRoles: ['owner'],
    fields: ['username', 'post_id', 'content_html', 'content_text', 'accent_color', 'doodle_data_url', 'updated_at'],
    permissionsAnyOf: ['blogpost_poster'],
  },
  {
    table: 'blog_post_tokens',
    category: 'content',
    purpose: 'Zugriffs-Tokens fuer Posts (Shared/One-Time, post-spezifisch oder user-global).',
    retention: 'bis Widerruf, Ablauf oder Verbrauch',
    accessRoles: ['owner'],
    fields: ['id', 'owner_user', 'post_id', 'token_hash (sha256)', 'kind', 'label', 'max_uses', 'used_count', 'expires_at', 'created_at', 'revoked_at'],
    permissionsAnyOf: ['blogpost_poster'],
  },
  {
    table: 'custom_fonts',
    category: 'content',
    purpose: 'Hochgeladene Schriftarten (Blob-Daten).',
    retention: 'unbegrenzt; Loeschung im Admin-Panel',
    accessRoles: ['superuser', 'global lesbar'],
    fields: ['id', 'family_name', 'original_filename', 'mime_type', 'format_hint', 'data (BLOB)', 'created_at'],
    permissionsAnyOf: ['super_access'],
  },
  {
    table: 'fractal_snapshots',
    category: 'content',
    purpose: 'Gespeicherte Fraktal-Bilder/Parameter.',
    retention: 'unbegrenzt; Loeschung auf Anfrage',
    accessRoles: ['owner', 'superuser'],
    fields: ['id', 'username', 'mode', '...'],
    permissionsAnyOf: ['minigames_access', 'rpg_access'],
  },
  {
    table: 'graffiti_tiles',
    category: 'content',
    purpose: 'Globales Graffiti-Overlay (gemeinschaftlich).',
    retention: 'unbegrenzt; Reset via Admin',
    accessRoles: ['alle eingeloggten', 'superuser'],
    fields: ['Tile-Daten gemaess graffiti.mdc'],
  },
  {
    table: 'site_user_inventory',
    category: 'content',
    purpose: 'Items, die du in deinem Inventar besitzt.',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['username', 'item_id', '...'],
  },
  {
    table: 'site_placed_items',
    category: 'content',
    purpose: 'Items, die du im Site-Overlay platziert hast.',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['username', 'item_id', 'position', '...'],
  },

  // === behavior ===
  {
    table: 'rpg_user_state',
    category: 'behavior',
    purpose: 'RPG/Quest-Fortschritt: addedIds, nodeDone, Stats.',
    retention: 'unbegrenzt; Reset im RPG-Settings',
    accessRoles: ['owner', 'superuser'],
    fields: ['username', 'payload (JSON)', '...'],
    permissionsAnyOf: ['rpg_access'],
  },
  {
    table: 'rpg_user_state_backups',
    category: 'behavior',
    purpose: 'Automatische Backups von rpg_user_state.',
    retention: 'rolling, aelteste Backups werden verdichtet',
    accessRoles: ['owner', 'superuser'],
    fields: ['id', 'username', 'backup_kind', 'payload (JSON)', 'created_at'],
    permissionsAnyOf: ['rpg_access'],
  },
  {
    table: 'minigame_progress',
    category: 'behavior',
    purpose: 'Spielfortschritt pro Minigame.',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['username', 'game_id', 'progress (JSON)'],
    permissionsAnyOf: ['minigames_access'],
  },
  {
    table: 'rpg_questmaker_items',
    category: 'behavior',
    purpose: 'Questmaker-Item-Katalog (Belohnungs-Anzeige).',
    retention: 'unbegrenzt',
    accessRoles: ['global lesbar', 'superuser'],
    fields: ['id', 'category', 'title', 'description'],
    permissionsAnyOf: ['rpg_access'],
  },
  {
    table: 'rpg_achievements',
    category: 'behavior',
    purpose: 'Achievements (global vs. user).',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['siehe rpg.mdc'],
    permissionsAnyOf: ['rpg_access'],
  },
  {
    table: 'rpg_locations',
    category: 'behavior',
    purpose: 'RPG-Locations + Inventar pro Location.',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['siehe rpg.mdc'],
    permissionsAnyOf: ['rpg_access'],
  },
  {
    table: 'ai_usage_log',
    category: 'behavior',
    purpose: 'Token-/Kosten-Log fuer KI-Features (z. B. RPG, Topic-Feeds).',
    retention: 'unbegrenzt (Abrechnung)',
    accessRoles: ['owner', 'superuser'],
    fields: ['username', 'feature', 'tokens', 'cost', 'created_at'],
    permissionsAnyOf: ['rpg_access', 'feed_access'],
  },
  {
    table: 'user_feeds',
    category: 'behavior',
    purpose: 'Topic-Feed-Konfiguration (eigene Feed-Sammlungen).',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['siehe custom-topic-feeds.mdc'],
    permissionsAnyOf: ['feed_access'],
  },
  {
    table: 'user_feed_sources',
    category: 'behavior',
    purpose: 'Quellen (URLs) pro Feed.',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['feed_id', 'url', 'kind'],
    permissionsAnyOf: ['feed_access'],
  },
  {
    table: 'user_feed_items',
    category: 'behavior',
    purpose: 'Gecachte Feed-Items.',
    retention: 'rolling cache',
    accessRoles: ['owner', 'superuser'],
    fields: ['feed_id', 'title', 'url', 'image_url', 'published_at', 'fetched_at'],
    permissionsAnyOf: ['feed_access'],
  },
  {
    table: 'user_feed_pins',
    category: 'behavior',
    purpose: 'Vom User gepinnte Feed-Items.',
    retention: 'unbegrenzt',
    accessRoles: ['owner', 'superuser'],
    fields: ['feed_id', 'item_id'],
    permissionsAnyOf: ['feed_access'],
  },
  {
    table: 'user_feed_summaries',
    category: 'behavior',
    purpose: 'KI-erzeugte Zusammenfassungen pro Feed.',
    retention: 'unbegrenzt; ueberschrieben',
    accessRoles: ['owner', 'superuser'],
    fields: ['feed_id', 'summary', 'generated_at'],
    permissionsAnyOf: ['feed_access'],
  },

  // === tester ===
  {
    table: 'tester_bug_reports',
    category: 'tester',
    purpose: 'User-eingereichte Bug-Reports inkl. Screenshots.',
    retention: 'bis User oder Superuser loescht',
    accessRoles: ['owner', 'superuser'],
    fields: ['id', 'username', 'screenshot', 'message', 'created_at'],
    permissionsAnyOf: ['tester_access'],
  },
  {
    table: 'tester_ui_preferences',
    category: 'tester',
    purpose: 'UI-Praeferenzen fuer Tester-Modus.',
    retention: 'unbegrenzt',
    accessRoles: ['owner'],
    fields: ['username', 'preferences (JSON)'],
    permissionsAnyOf: ['tester_access'],
  },

  // === network ===
  {
    table: 'request_log',
    category: 'network',
    purpose: 'Eingangs-Log auf oeffentlichen Post-Routen. Zaehlt Crawler, Bot-Familien, Blocks, dient als Rate-Limit-Quelle.',
    retention: '30 Tage Rohlog; Aggregat (request_stats_daily) bleibt unbegrenzt OHNE ip_hash',
    accessRoles: ['superuser', 'aggregiert: owner pro eigenem Post'],
    fields: ['id', 'ts', 'path', 'post_id', 'username', 'ua_string', 'ua_category', 'ua_bot_name', 'ip_hash (sha256+salt)', 'country', 'referer', 'status', 'blocked_reason'],
  },
  {
    table: 'request_stats_daily',
    category: 'network',
    purpose: 'Aggregat-Statistik (Datum × Scope × UA-Kategorie × Bot × Status). Keine IP, kein UA-Klartext.',
    retention: 'unbegrenzt',
    accessRoles: ['superuser', 'aggregiert: owner pro eigenem Post'],
    fields: ['date', 'scope_kind', 'scope_id', 'ua_category', 'ua_bot_name', 'status', 'count'],
  },

  // === user-defaults ===
  {
    table: 'user_privacy_defaults',
    category: 'auth',
    purpose: 'Profil-weite Privacy-Standards: Default-Visibility, Hub-/Full-Hidden, block_all_ai, Backup-Webhook-URL.',
    retention: 'solange Account besteht',
    accessRoles: ['owner'],
    fields: ['username', 'default_visibility', 'default_flags', 'hub_excluded', 'full_hidden', 'block_all_ai', 'backup_webhook_url', 'updated_at'],
    permissionsAnyOf: ['blogpost_poster'],
  },

  // === global ===
  {
    table: 'site_settings',
    category: 'global',
    purpose: 'Site-weite Key-Value-Settings ohne User-Bezug.',
    retention: 'unbegrenzt',
    accessRoles: ['superuser'],
    fields: ['setting_key', 'value'],
  },
  {
    table: 'site_item_catalog',
    category: 'global',
    purpose: 'Item-Katalog (Site-Inventar).',
    retention: 'unbegrenzt',
    accessRoles: ['global lesbar', 'superuser'],
    fields: ['siehe site-theme-system.mdc'],
  },
  {
    table: 'feed_allowlist',
    category: 'global',
    purpose: 'Vertrauenswuerdige Feed-Hosts.',
    retention: 'unbegrenzt',
    accessRoles: ['superuser'],
    fields: ['kind', 'value', 'category', 'trust_tier'],
  },
  {
    table: 'feed_blocklist',
    category: 'global',
    purpose: 'Blockierte Feed-Hosts.',
    retention: 'unbegrenzt',
    accessRoles: ['superuser'],
    fields: ['host_pattern'],
  },
];

export const CATEGORY_LABELS = {
  auth:    'Anmeldung & Rechte',
  content: 'Eigene Inhalte',
  behavior:'Verhalten & Fortschritt',
  tester:  'Tester-Tools',
  network: 'Server-Logs',
  global:  'Globale Site-Konfiguration',
};

export const EXTERNAL_SERVICES = [
  {
    name: 'Vercel',
    function: 'Hosting + Serverless-Functions + Edge-Header (IP, Country)',
    dataCategory: 'Alle eingehenden Requests werden von Vercel-Infrastruktur verarbeitet',
    region: 'Auswahl bei Vercel-Projekt',
    avv: 'Vercel-AVV (Standard)',
  },
  {
    name: 'Turso (libsql)',
    function: 'Produktiv-Datenbank (alle oben gelisteten Tabellen)',
    dataCategory: 'Alle persistenten User-Daten',
    region: 'Auswahl bei Turso-Projekt',
    avv: 'Turso-AVV',
  },
  {
    name: 'Anthropic / OpenAI (gemaess Feature)',
    function: 'KI-Verarbeitung fuer RPG-Hinweise, Topic-Feed-Zusammenfassungen u. a.',
    dataCategory: 'Nur was der User ausdruecklich in KI-Features eingibt; siehe ai_usage_log',
    region: 'lt. Anbieter-Doku',
    avv: 'Anbieter-AVV',
  },
  {
    name: 'GitHub',
    function: 'Code-Hosting (kein User-Daten-Empfaenger)',
    dataCategory: '—',
    region: 'global',
    avv: '—',
  },
];

/**
 * Filtert das Inventar gegen die effektiven Permissions eines Users.
 * `userPermissions`: Array von Permission-Strings, die der User HAT.
 * Eintraege ohne `permissionsAnyOf` (oder leer) sind immer sichtbar.
 * Superuser sieht grundsaetzlich alles.
 */
export function filterInventoryForUser(userPermissions = []) {
  const have = new Set(userPermissions || []);
  const isSuper = have.has('super_access');
  return DATA_INVENTORY.filter((entry) => {
    if (isSuper) return true;
    const req = entry.permissionsAnyOf;
    if (!Array.isArray(req) || req.length === 0) return true;
    return req.some((p) => have.has(p));
  });
}

export const BROWSER_STORAGE = [
  {
    key: 'session (Cookie, httpOnly)',
    purpose: 'JWT-Session-Cookie nach Login.',
    lifetime: '7 Tage (rolling)',
  },
  {
    key: 'localStorage: blogpost:draft:<postId|new>',
    purpose: 'Browser-seitiger Editor-Draft fuer Crash-Recovery (A1).',
    lifetime: 'bis User loescht oder erfolgreicher Server-Save',
  },
  {
    key: 'localStorage: Theme + UI-Praeferenzen',
    purpose: 'Light/Dark-Mode + Custom-Font-Wahl.',
    lifetime: 'bis User loescht',
  },
];
