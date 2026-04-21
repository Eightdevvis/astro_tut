/**
 * KI-Vorschlag für Topic-Feed (Quellen + Stichworte), ohne Persistenz.
 */

import { ensureDbSchema, getDb } from './db.js';
import { listAllowlistForAiContext, classifyRssUrl, parseHttpsUrl } from './feed-policy.js';
import { openaiJsonCompletion } from './feed-openai.js';
import { recordAiUsage } from './ai-usage-db.js';

const FEATURE = 'topic_feed_plan';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_PROMPT = 6000;

const SYSTEM = `Du hilfst beim Aufbau eines persönlichen RSS-Themen-Feeds.
Antworte NUR mit einem JSON-Objekt (kein Markdown). Pflichtfelder:
- "understood": string — kurz auf Deutsch, was du aus der Nutzerbeschreibung verstanden hast
- "keywords": string[] — 4–12 Such-/Schlagwörter (Deutsch oder Englisch, je nach Thema)
- "rss_urls": string[] — 3–12 **konkrete https-URLs** zu RSS- oder Atom-Feeds, die zum Thema passen
- "rationale": string — 1–3 Sätze Deutsch: warum diese Feeds passen
- "deep_links": Array von { "title": string, "url": string } — 0–5 **https**-Links zu Übersichtsseiten (Labs, Hersteller, Konferenzen), keine RSS nötig

Regeln:
- Nur https-URLs; keine IP-Adressen; keine Login-geschützten Feed-URLs erfinden.
- Nutze wo möglich Feeds aus der mitgelieferten Vertrauensliste; du darfst auch andere sinnvolle **öffentliche** RSS-URLs vorschlagen (z. B. bekannte Medien), wenn sie zum Thema passen — der Server markiert sie ggf. als „Bestätigung nötig“.
- Keine erfundenen Pfade: wenn du dir unsicher bist, nimm nur Feeds, die typischerweise existieren (z. B. arxiv.org/rss/...).`;

/**
 * @param {string} username
 * @param {string} userPrompt
 */
export async function runFeedPlanAi(username, userPrompt) {
  const env = import.meta.env;
  const apiKey = String(env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY fehlt');
    // @ts-ignore
    err.code = 'NO_API_KEY';
    throw err;
  }
  const model = String(env.FEED_OPENAI_MODEL ?? env.RPG_OPENAI_MODEL ?? '').trim() || DEFAULT_MODEL;
  const baseUrl = env.OPENAI_BASE_URL;

  await ensureDbSchema();
  const db = getDb();
  const allow = await listAllowlistForAiContext(db);
  const allowText = allow
    .map((a) => `${a.kind}:${a.value} (Kategorie: ${a.category || '-'}, Vertrauen: ${a.trust_tier})`)
    .join('\n');

  const userMsg = `Nutzer-Thema / Interessen (Freitext):\n${userPrompt}\n\nVertrauensliste (bevorzugt diese Feeds/Hosts nutzen):\n${allowText || '(leer)'}`;

  const { completion, parsed } = await openaiJsonCompletion(
    apiKey,
    baseUrl,
    model,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
    0.4
  );

  await recordAiUsage({ username, feature: FEATURE, model, completion });

  const understood = typeof parsed.understood === 'string' ? parsed.understood.trim() : '';
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  const rawRss = Array.isArray(parsed.rss_urls) ? parsed.rss_urls : [];
  const rss_urls = [];
  for (const x of rawRss) {
    const u = parseHttpsUrl(String(x));
    if (u) rss_urls.push(u.toString());
  }
  const deep_links = [];
  const rawDl = Array.isArray(parsed.deep_links) ? parsed.deep_links : [];
  for (const d of rawDl) {
    if (!d || typeof d !== 'object') continue;
    const title = String(/** @type {any} */ (d).title || '').trim().slice(0, 200);
    const url = parseHttpsUrl(String(/** @type {any} */ (d).url || ''));
    if (url) deep_links.push({ title: title || url.hostname, url: url.toString() });
  }

  /** @type {{ url: string; autoIngest: boolean; trustTier: number; reason?: string }[]} */
  const classified_auto = [];
  /** @type {{ url: string; reason: string }[]} */
  const classified_needs_confirm = [];
  for (const url of rss_urls) {
    const c = await classifyRssUrl(db, url);
    if (c.autoIngest) classified_auto.push({ url, autoIngest: true, trustTier: c.trustTier });
    else classified_needs_confirm.push({ url, reason: c.reason || 'Bestätigung nötig.' });
  }

  return {
    understood: understood || userPrompt.slice(0, 400),
    keywords,
    rationale,
    rss_urls_all: rss_urls,
    rss_classified_auto: classified_auto,
    rss_classified_needs_confirm: classified_needs_confirm,
    deep_links,
    ai_plan_raw: parsed,
  };
}
