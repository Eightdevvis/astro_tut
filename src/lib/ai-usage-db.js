/**
 * Protokollierung von KI-Nutzung pro eingeloggtem User (serverseitig, OpenAI-kompatible `usage`).
 */

import { ensureDbSchema, getDb } from './db.js';

/** @type {Record<string, string>} Anzeigenamen für UI; Keys = `feature`-Spalte */
export const AI_FEATURE_LABELS = {
  rpg: 'RPG (Questmaker & Quest-Graph)',
};

export const AI_FEATURE_RPG = 'rpg';

/**
 * @param {unknown} completion — Chat-Completion-JSON (Antwortbody)
 * @returns {{ prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number | null; generation_id: string | null }}
 */
export function parseCompletionUsage(completion) {
  const u = completion && typeof completion === 'object' ? /** @type {any} */ (completion).usage : null;
  if (!u || typeof u !== 'object') {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost: null,
      generation_id: typeof /** @type {any} */ (completion)?.id === 'string' ? /** @type {any} */ (completion).id : null,
    };
  }
  const pt = Number(u.prompt_tokens) || 0;
  const ct = Number(u.completion_tokens) || 0;
  const tt = Number(u.total_tokens) || pt + ct;
  let cost = null;
  if (typeof u.cost === 'number' && !Number.isNaN(u.cost)) cost = u.cost;
  else if (typeof u.total_cost === 'number' && !Number.isNaN(u.total_cost)) cost = u.total_cost;
  const gen =
    typeof completion === 'object' && completion && typeof /** @type {any} */ (completion).id === 'string'
      ? /** @type {any} */ (completion).id
      : null;
  return { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt, cost, generation_id: gen };
}

/**
 * @param {{ username: string; feature: string; model: string; completion: unknown }} p
 */
export async function recordAiUsage(p) {
  const { username, feature, model, completion } = p;
  const { prompt_tokens, completion_tokens, total_tokens, cost, generation_id } = parseCompletionUsage(completion);
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO ai_usage_log
      (username, feature, model, prompt_tokens, completion_tokens, total_tokens, cost, generation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [username, feature, model, prompt_tokens, completion_tokens, total_tokens, cost, generation_id],
  });
}

/**
 * Aggregat + letzte Einträge für die Nutzer-Ansicht.
 * @param {string} username
 */
export async function getAiUsageReportForUser(username) {
  await ensureDbSchema();
  const db = getDb();

  const byFeature = await db.execute({
    sql: `SELECT
        feature,
        COUNT(*) AS requests,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        SUM(cost) AS cost_sum
      FROM ai_usage_log
      WHERE username = ?
      GROUP BY feature
      ORDER BY feature`,
    args: [username],
  });

  const recent = await db.execute({
    sql: `SELECT id, feature, model, prompt_tokens, completion_tokens, total_tokens, cost, created_at
      FROM ai_usage_log
      WHERE username = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 80`,
    args: [username],
  });

  /** @type {{ feature: string; requests: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_sum: number | null }[]} */
  const features = (byFeature.rows || []).map((row) => {
    const r = /** @type {Record<string, unknown>} */ (row);
    return {
      feature: String(r.feature ?? ''),
      requests: Number(r.requests) || 0,
      prompt_tokens: Number(r.prompt_tokens) || 0,
      completion_tokens: Number(r.completion_tokens) || 0,
      total_tokens: Number(r.total_tokens) || 0,
      cost_sum: r.cost_sum == null || r.cost_sum === '' ? null : Number(r.cost_sum),
    };
  });

  let totalRequests = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokens = 0;
  let costGrand = 0;
  let hasCost = false;
  for (const f of features) {
    totalRequests += f.requests;
    totalPrompt += f.prompt_tokens;
    totalCompletion += f.completion_tokens;
    totalTokens += f.total_tokens;
    if (f.cost_sum != null && !Number.isNaN(f.cost_sum)) {
      hasCost = true;
      costGrand += f.cost_sum;
    }
  }

  return {
    features: features.map((f) => ({
      ...f,
      label: AI_FEATURE_LABELS[f.feature] || f.feature,
    })),
    totals: {
      requests: totalRequests,
      prompt_tokens: totalPrompt,
      completion_tokens: totalCompletion,
      total_tokens: totalTokens,
      cost_sum: hasCost ? costGrand : null,
    },
    recent: (recent.rows || []).map((row) => {
      const r = /** @type {Record<string, unknown>} */ (row);
      return {
        id: Number(r.id),
        feature: String(r.feature ?? ''),
        label: AI_FEATURE_LABELS[String(r.feature ?? '')] || String(r.feature ?? ''),
        model: String(r.model ?? ''),
        prompt_tokens: Number(r.prompt_tokens) || 0,
        completion_tokens: Number(r.completion_tokens) || 0,
        total_tokens: Number(r.total_tokens) || 0,
        cost: r.cost == null || r.cost === '' ? null : Number(r.cost),
        created_at: String(r.created_at ?? ''),
      };
    }),
  };
}
