/**
 * KI-Kurzzusammenfassung für einen Topic-Feed (Deutsch).
 */

import { ensureDbSchema, getDb } from './db.js';
import { getFeedDetailBundle, insertFeedSummary } from './feed-db.js';
import { openaiJsonCompletion } from './feed-openai.js';
import { recordAiUsage } from './ai-usage-db.js';

const FEATURE = 'topic_feed_summary';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MIN_ITEMS_FOR_SUMMARY = 2;
const MAX_HEADLINES = 18;

const SYSTEM = `Du schreibst eine kurze, nüchterne Zusammenfassung auf Deutsch für einen persönlichen News-Feed.
Antworte NUR mit JSON: { "body_md": string, "covers_note": string }
- body_md: Markdown, 2–6 Absätze oder Aufzählungen. Nutze **nur** Schlagzeilen, die zum mitgelieferten **Themen-Anker** passen; ignoriere off-topic Einträge still (keine Meta-Klage). Keine neuen Fakten erfinden. Am Ende eine Zeile „Quellen (Domains): …“.
- covers_note: ein kurzer Satz zu Zeitraum/Umfang (z. B. „Fokus auf die jüngsten 15 Einträge“).

Disclaimer-Hinweis kurz: keine Rechts-/Medizin-/Anlageberatung; Nutzer soll Primärquellen prüfen.`;

/**
 * @param {string} username
 * @param {number} feedId
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<boolean>} ob geschrieben
 */
export async function maybeGenerateFeedSummary(username, feedId, opts = {}) {
  await ensureDbSchema();
  const bundle = await getFeedDetailBundle(username, feedId);
  if (!bundle) return false;
  const items = bundle.items || [];
  if (items.length < MIN_ITEMS_FOR_SUMMARY) return false;

  const env = import.meta.env;
  const apiKey = String(env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) return false;

  const headlines = items.slice(0, MAX_HEADLINES).map((it) => ({
    title: it.title,
    url: it.url,
    domain: it.domain,
    published_at: it.published_at,
  }));
  const domains = [...new Set(headlines.map((h) => h.domain).filter(Boolean))];

  let topic_anchor = '';
  let drift_guard = [];
  try {
    const p = JSON.parse(String(bundle.meta.ai_plan_json || '{}'));
    if (typeof p.topic_anchor === 'string') topic_anchor = p.topic_anchor.trim();
    if (Array.isArray(p.drift_guard)) drift_guard = p.drift_guard.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* ignore */
  }

  const lastSum = bundle.summary;
  if (!opts.force && lastSum?.generated_at) {
    const genAt = Date.parse(String(lastSum.generated_at));
    if (!Number.isNaN(genAt) && Date.now() - genAt < 6 * 60 * 60 * 1000) return false;
  }

  const model = String(env.FEED_OPENAI_MODEL ?? env.RPG_OPENAI_MODEL ?? '').trim() || DEFAULT_MODEL;
  const baseUrl = env.OPENAI_BASE_URL;

  const userMsg = JSON.stringify(
    {
      feed_title: bundle.meta.title,
      user_prompt: bundle.meta.user_prompt,
      topic_anchor: topic_anchor || null,
      drift_guard: drift_guard.length ? drift_guard : null,
      headlines,
      domains,
    },
    null,
    0
  );

  let parsed;
  let completion;
  try {
    const r = await openaiJsonCompletion(
      apiKey,
      baseUrl,
      model,
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      0.35
    );
    completion = r.completion;
    parsed = r.parsed;
  } catch {
    return false;
  }

  await recordAiUsage({ username, feature: FEATURE, model, completion });

  const body_md = typeof parsed.body_md === 'string' ? parsed.body_md.trim() : '';
  if (!body_md) return false;
  const covers_through = items[0]?.published_at || items[0]?.fetched_at || null;
  const covers_note = typeof parsed.covers_note === 'string' ? parsed.covers_note.trim() : '';

  await insertFeedSummary(feedId, {
    body_md: covers_note ? `${body_md}\n\n_${covers_note}_\n` : body_md,
    covers_through: covers_through,
    model,
  });
  return true;
}

/**
 * Cron: für Feeds mit neuen Items seit letzter Summary (vereinfacht: letzte N Feeds mit Items).
 * @param {{ max?: number }} opts
 */
export async function summarizeFeedsRoundRobin(opts = {}) {
  await ensureDbSchema();
  const db = getDb();
  const max = Math.min(15, Math.max(1, Number(opts.max) || 8));
  const res = await db.execute({
    sql: `SELECT f.id, f.username FROM user_feeds f
          WHERE EXISTS (SELECT 1 FROM user_feed_items i WHERE i.feed_id = f.id)
          ORDER BY datetime(COALESCE(f.updated_at, f.created_at)) DESC
          LIMIT ?`,
    args: [max],
  });
  let n = 0;
  for (const row of res.rows || []) {
    const r = /** @type {any} */ (row);
    const id = Number(r.id);
    const uname = String(r.username || '');
    if (!Number.isFinite(id) || !uname) continue;
    const ok = await maybeGenerateFeedSummary(uname, id, {});
    if (ok) n += 1;
  }
  return n;
}
