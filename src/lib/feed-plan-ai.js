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

const SYSTEM = `Du planst einen persönlichen **News-/Entwicklungs-Feed** zu **genau dem Thema**, das der Nutzer nennt — nicht zu einem größeren Nachbarfach, es sei denn, der Nutzer hat dieses Fach **ausdrücklich** so genannt.

Ziel des Feeds: **Neuigkeiten und Entwicklungen zu genau diesem Thema** (kommerziell/Markt, wissenschaftlich, politisch/regulatorisch — was immer für das genannte Thema sinnvoll ist: Archäologie, Kultur, Wirtschaft, Tech, …). Kein „Lehrbuch-Sammelsurium“ in Nachbardisziplinen.

Antworte NUR mit einem JSON-Objekt (kein Markdown). Pflichtfelder:
- "topic_anchor": string — **ein prägnanter Satz** Deutsch: welches **konkrete** Thema dieser Feed deckt; nimm zentrale Begriffe aus dem Nutzerprompt wörtlich oder minimal eingedeutscht auf; keine weiche Umschreibung in ein Obergebiet (nicht: „Computer Vision allgemein“, wenn der Nutzer „Hologrammtechnik“ schrieb).
- "understood": string — **ein Satz** Deutsch: dieselbe fachliche Zielrichtung wie topic_anchor, ohne Meta-Formulierungen wie „Der Nutzer interessiert sich für …“ (direkt sachlich formulieren).
- "keywords": string[] — 5–14 Stichwörter; **mindestens zwei** müssen aus dem Nutzerprompt stammen oder direkte Schreibweisen davon sein; nutze den Rest zum **Einengen**, nicht zum Öffnen in fachfremde Gebiete.
- "drift_guard": string[] — **4–8** kurze Stichworte/Themen, die typischerweise **falsch** wären (häufige Verwechslungen / zu breite Nachbargebiete), die dieser Feed **nicht** primär abdecken soll (z. B. bei „Hologrammtechnik“: allgemeine Topologie, reine Graphentheorie, generisches CV-Lehrbuch-Thema ohne Display/Holografie-Bezug — nur Beispiele; passe an den **tatsächlichen** Nutzerprompt an).
- "rss_urls": string[] — 3–12 **konkrete https-URLs** zu RSS/Atom-Feeds. Jeder Feed muss plausibel **Schlagzeilen zu topic_anchor** liefern, nicht nur derselben Hochschulkategorie. **arXiv:** nur Kategorien/Feeds, die **inhaltlich** zu topic_anchor passen — nicht pauschal cs.CV/cs.GR, wenn der Nutzer ein Display-/Holografie-Thema meint (dann eher spezifischere Pfade wie eess.IV o. Ä., **wenn** sie zum Thema passen; sonst andere erlaubte Quellen).
- "rationale": string — 2–4 Sätze Deutsch: warum **jede** gewählte Quelle **konkret** zu topic_anchor beiträgt (kein „vertrauenswürdig und aktuell“ ohne Thembezug).
- "deep_links": Array von { "title": string, "url": string } — 0–5 **https**-Links (Labs, Hersteller, Behörden, Institute), die **direkt** zum Thema gehören.

Harte Regeln:
- Nur https-URLs; keine IP-Adressen; keine erfundenen Pfade.
- Keine Feed-Vorschläge, deren typische Inhalte **nur** ein Oberfeld abdecken, während der Nutzer ein **spezifisches** Produkt/Konzept/Kulturphänomen genannt hat.
- Wenn der Nutzerprompt sehr kurz ist (ein Wort), behandle ihn trotzdem als **scharfen Anker**; frage dich: „Würde ein Leser, der nur dieses Thema will, mit dieser Quelle zufrieden sein?“ — wenn nein, andere Quelle.
- Vertrauensliste unten bevorzugen; andere öffentliche RSS nur wenn klar themenrelevant — der Server markiert sonst „Bestätigung nötig“.`;

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

  const userMsg = `Nutzer-Thema (Freitext, das ist der **einzige inhaltliche Anker** — nicht weiten):\n${userPrompt}\n\nVertrauensliste (bevorzugt diese Feeds/Hosts nutzen):\n${allowText || '(leer)'}`;

  const { completion, parsed } = await openaiJsonCompletion(
    apiKey,
    baseUrl,
    model,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
    0.28
  );

  await recordAiUsage({ username, feature: FEATURE, model, completion });

  const topic_anchor =
    typeof parsed.topic_anchor === 'string' && parsed.topic_anchor.trim()
      ? parsed.topic_anchor.trim().slice(0, 400)
      : '';
  let understood = typeof parsed.understood === 'string' ? parsed.understood.trim() : '';
  if (/^(der nutzer|die nutzerin)\b/i.test(understood)) {
    understood = understood
      .replace(/^(der nutzer|die nutzerin)\s+(interessiert sich|möchte|will)\s+(für\s+)?/i, '')
      .replace(/^(der nutzer|die nutzerin)\s*[:,]\s*/i, '')
      .trim();
    if (understood.length) understood = understood.charAt(0).toUpperCase() + understood.slice(1);
  }
  if (!understood && topic_anchor) understood = topic_anchor;
  const drift_guard = Array.isArray(parsed.drift_guard)
    ? parsed.drift_guard.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
    : [];
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
    topic_anchor: topic_anchor || understood || userPrompt.slice(0, 200),
    understood: understood || userPrompt.slice(0, 400),
    drift_guard,
    keywords,
    rationale,
    rss_urls_all: rss_urls,
    rss_classified_auto: classified_auto,
    rss_classified_needs_confirm: classified_needs_confirm,
    deep_links,
    ai_plan_raw: parsed,
  };
}
