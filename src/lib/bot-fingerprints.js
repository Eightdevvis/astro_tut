/**
 * Single-Source-of-Truth fuer alle bekannten Bot-User-Agents.
 *
 * Wird gleichzeitig vom UA-Gate (B4 — hart blocken) und vom request_log
 * (Phase 12 — zaehlen) gelesen. So koennen "wir blocken" und "wir zaehlen
 * als Bot" niemals auseinanderlaufen.
 *
 * Eintraege je Bot:
 *   { pattern: RegExp, name: kanonischer Anzeigename, category: gruppe }
 *
 * Gruppen:
 *   - 'ai'      — KI-Training/Usage-Crawler
 *   - 'search'  — klassische Suchmaschinen-Crawler
 *   - 'social'  — Link-Preview-Bots (Discord, Slack, …)
 *   - 'archive' — Internet Archive & Co.
 *
 * Pflege: jedes Mal wenn ein neuer Bot in den Logs auftaucht, hier
 * ergaenzen. LAST_REVIEWED-Konstante macht Wartungsdruck sichtbar.
 */

export const LAST_REVIEWED = '2026-05-16';

export const BOT_FINGERPRINTS = [
  // === KI-Crawler ===
  { pattern: /GPTBot\b/i,                name: 'GPTBot',              category: 'ai' },
  { pattern: /ChatGPT-User\b/i,          name: 'ChatGPT-User',        category: 'ai' },
  { pattern: /OAI-SearchBot\b/i,         name: 'OAI-SearchBot',       category: 'ai' },
  { pattern: /ClaudeBot\b/i,             name: 'ClaudeBot',           category: 'ai' },
  { pattern: /Claude-Web\b/i,            name: 'Claude-Web',          category: 'ai' },
  { pattern: /anthropic-ai\b/i,          name: 'anthropic-ai',        category: 'ai' },
  { pattern: /CCBot\b/i,                 name: 'CCBot',               category: 'ai' },
  { pattern: /Google-Extended\b/i,       name: 'Google-Extended',     category: 'ai' },
  { pattern: /PerplexityBot\b/i,         name: 'PerplexityBot',       category: 'ai' },
  { pattern: /Perplexity-User\b/i,       name: 'Perplexity-User',     category: 'ai' },
  { pattern: /Bytespider\b/i,            name: 'Bytespider',          category: 'ai' },
  { pattern: /Amazonbot\b/i,             name: 'Amazonbot',           category: 'ai' },
  { pattern: /Meta-ExternalAgent\b/i,    name: 'Meta-ExternalAgent',  category: 'ai' },
  { pattern: /ImagesiftBot\b/i,          name: 'ImagesiftBot',        category: 'ai' },
  { pattern: /Diffbot\b/i,               name: 'Diffbot',             category: 'ai' },
  { pattern: /Omgili\b/i,                name: 'Omgili',              category: 'ai' },
  { pattern: /cohere-ai\b/i,             name: 'cohere-ai',           category: 'ai' },
  { pattern: /YouBot\b/i,                name: 'YouBot',              category: 'ai' },
  { pattern: /Applebot-Extended\b/i,     name: 'Applebot-Extended',   category: 'ai' },
  { pattern: /DuckAssistBot\b/i,         name: 'DuckAssistBot',       category: 'ai' },
  { pattern: /MistralAI-User\b/i,        name: 'MistralAI-User',      category: 'ai' },
  { pattern: /AI2Bot\b/i,                name: 'AI2Bot',              category: 'ai' },
  { pattern: /PanguBot\b/i,              name: 'PanguBot',            category: 'ai' },
  { pattern: /Kangaroo\s*Bot/i,          name: 'KangarooBot',         category: 'ai' },

  // === Klassische Suche ===
  // Applebot OHNE -Extended; das Lookahead trennt es vom AI-Eintrag oben.
  { pattern: /Googlebot\b/i,             name: 'Googlebot',           category: 'search' },
  { pattern: /Bingbot\b/i,               name: 'Bingbot',             category: 'search' },
  { pattern: /DuckDuckBot\b/i,           name: 'DuckDuckBot',         category: 'search' },
  { pattern: /Applebot\b(?!-)/i,         name: 'Applebot',            category: 'search' },
  { pattern: /YandexBot\b/i,             name: 'YandexBot',           category: 'search' },
  { pattern: /Baiduspider\b/i,           name: 'Baiduspider',         category: 'search' },
  { pattern: /Seznambot\b/i,             name: 'Seznambot',           category: 'search' },
  { pattern: /Sogou\b/i,                 name: 'Sogou',               category: 'search' },

  // === Social-Preview ===
  { pattern: /facebookexternalhit/i,     name: 'facebookexternalhit', category: 'social' },
  { pattern: /FacebookBot\b/i,           name: 'FacebookBot',         category: 'social' },
  { pattern: /Twitterbot\b/i,            name: 'Twitterbot',          category: 'social' },
  { pattern: /LinkedInBot\b/i,           name: 'LinkedInBot',         category: 'social' },
  { pattern: /Discordbot\b/i,            name: 'Discordbot',          category: 'social' },
  { pattern: /Slackbot\b/i,              name: 'Slackbot',            category: 'social' },
  { pattern: /TelegramBot\b/i,           name: 'TelegramBot',         category: 'social' },
  { pattern: /WhatsApp\b/i,              name: 'WhatsApp',            category: 'social' },

  // === Archive ===
  { pattern: /ia_archiver\b/i,           name: 'ia_archiver',         category: 'archive' },
  { pattern: /archive\.org_bot/i,        name: 'archive.org_bot',     category: 'archive' },
  { pattern: /Wayback\b/i,               name: 'Wayback',             category: 'archive' },
];

const HUMAN_BROWSER = /Mozilla\/|AppleWebKit\/|Chrome\/|Safari\/|Firefox\/|Edg\/|OPR\/|Vivaldi\//i;
const SUSPICIOUS_TOKEN = /bot|crawl|spider|index|scrap|wget|curl|httpclient|python-requests/i;

/**
 * Klassifiziert einen UA-String.
 * Rueckgabe: { category, botName }
 *   - category: 'ai' | 'search' | 'social' | 'archive' | 'human' | 'unknown'
 *   - botName: kanonischer Name, sonst null
 *
 * Heuristik: bekannte Bot-Pattern haben Vorrang. Sieht der UA wie ein
 * Browser aus und enthaelt keinen Crawler-Indikator → 'human'. Alles
 * andere → 'unknown'.
 */
export function classifyUserAgent(ua) {
  const s = String(ua || '').trim();
  if (!s) return { category: 'unknown', botName: null };
  for (const fp of BOT_FINGERPRINTS) {
    if (fp.pattern.test(s)) {
      return { category: fp.category, botName: fp.name };
    }
  }
  if (HUMAN_BROWSER.test(s) && !SUSPICIOUS_TOKEN.test(s)) {
    return { category: 'human', botName: null };
  }
  return { category: 'unknown', botName: null };
}

/**
 * Liefert nur die Namen der Bots einer Gruppe — fuer robots.txt-Aufbau.
 */
export function botsInCategory(category) {
  return BOT_FINGERPRINTS.filter((fp) => fp.category === category).map((fp) => fp.name);
}
