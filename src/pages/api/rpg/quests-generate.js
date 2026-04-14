import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { listQuestmakerCatalogRows } from '../../../lib/rpg-questmaker-catalog-db.js';
import { normalizeQuestId, labelsToSteps } from '../../../lib/rpg-quest-form-helpers.js';
import {
  normalizeQuestStepsTree,
  normalizeQuestRewardRows,
  questRewardRowToStored,
} from '../../../lib/rpg-quest-steps.js';
import {
  collectItemIdsFromStepsAndQuestRewards,
  normalizeQuestmakerCatalogPayloadItem,
} from '../../../lib/rpg-questmaker-sync.js';
import { AI_FEATURE_RPG, recordAiUsage } from '../../../lib/ai-usage-db.js';

const MAX_PROMPT_LEN = 6000;
const DEFAULT_MODEL = 'gpt-4o-mini';

/** @param {string | undefined} raw */
function chatCompletionsUrl(raw) {
  const base = (raw?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

/**
 * Strukturierte Quest-Antworten sind zu komplex für `json_schema`+strict bei allen Anbietern.
 * Einheitlich `json_object` + serverseitige Prüfung.
 */
const JSON_OBJECT_INSTRUCTION = `

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown, kein Code-Fence). Pflicht-Top-Level-Key: "responseType" mit dem Wert "clarify" oder "quest".

Wenn "responseType":"clarify":
- "questions": Array von 1–6 kurzen Rückfragen auf Deutsch (was dir für eine realistische Quest noch fehlt: Ort, Datum, Institution, Budget, …).

Wenn "responseType":"quest":
- "id": kurzer Slug (Kleinbuchstaben, Bindestriche, max. 48 Zeichen)
- "title": prägnant; darf metaphorisch, leicht rätselhaft oder ironisch klingen (wie ein Randtitel), muss sich aber auf die **echte** Situation aus dem Nutzer-Prompt beziehen — keine fiktive Handlung, keine Fantasy-Welt
- "description": 1–3 Sätze über **echtes** Leben; Stil wie der Rand einer gut geschriebenen Geschichte: expressiv, warm oder leicht mystisch, wo es passt — nicht trocken oder rein verwaltungsmäßig
- "kind": "main" oder "side"
- "rewards": optional 0–8 kurze Texte ODER weglassen wenn du "questRewards" nutzt
- "questRewards": optional Array von { "type": "text", "text": "…" } oder { "type": "item", "itemId": "…", "displayName": "…" } oder { "type": "points", "pointKind": "heart"|"mana", "amount": Ganzzahl } (amount darf negativ sein); optional pro Eintrag "unlockAtPercent": Ganzzahl 0–100 (Freischaltung ab Quest-Fortschritt %); weglassen = automatische Verteilung wie im Editor
- "questmakerItems": Pflicht sobald du irgendwo eine **neue** itemId verwendest (nicht in ITEM_KATALOG): Array von { "id", "category", "title", "description" } — category eine von: alltag, studium, arbeit, gesundheit, beziehungen, organisation, sonstiges; title und description jeweils nicht leer (Kurzbeschreibung des Items).
- "steps": Array aus Schritt-Objekten (siehe unten)

Schritt-Objekt (rekursiv, "substeps" optional):
- "id": kurzer technischer Schlüssel (ascii, eindeutig innerhalb der Quest)
- "label": **konkrete, in der Realität vollständig nachvollziehbare Handlung** (klar genug zum Umsetzen: was, wo, mit wem — keine Halluzination). Formulierung darf bildhaft oder leicht mystisch sein, darf aber nicht verschleiern, was zu tun ist
- "optional": boolean
- "dependsOn": Array von ids anderer Schritte (gleiche Quest), die zuerst erledigt sein müssen; leer [] wenn keine Abhängigkeit
- "reward": optional string ODER { "type": "text", "text": "…" } ODER { "type": "item", "itemId": "…", "displayName": "…" } ODER { "type": "points", "pointKind": "heart"|"mana", "amount": Ganzzahl } — bei neuer itemId Eintrag in "questmakerItems" (siehe oben). Für Punkte: heart = körperliche Herzpunkte (z. B. Bewegung: plus, Belastung: minus); mana = geistige Manapunkte (Lernen/Konzentration oft minus, Erholung plus — je nach Schritt sinnvoll setzen).
- "timeDueAt": optional ISO-Datum "YYYY-MM-DD" nur wenn eine echte Frist sinnvoll ist (z. B. Bewerbungsende)
- "substeps": optional Array weiterer Schritt-Objekte für Gruppen (Unterschritte)

Nutze "substeps" und "dependsOn", wenn die Aufgabe nicht nur eine flache Liste ist. **Inhalt** immer echtes Leben des Nutzers — keine erfundene Quest, keine Spielwelt. **Sprache** darf Alltag als bedeutsam, spannend oder fast magisch rahmen (Metaphern, leichte Mystik), aber ohne RPG-Klischees wie „Held“, „Dungeon“, „NPC“. Die internen Reward-Typen "heart"/"mana" bei "points" sind erlaubt (Symbole in der UI).

Wenn ein passendes Item schon in ITEM_KATALOG steht, nutze dieselbe itemId. Wenn du ein neues Item brauchst: erfinde eine stabile slug-artige itemId und liefere die vollständige Zeile in "questmakerItems". Weder neue Items ohne questmakerItems noch leere description/title bei neuen Items.`;

/** @param {{ id: string; category: string; title: string; description: string }[]} rows */
function formatCatalogInstruction(rows) {
  if (!rows.length) {
    return `

ITEM_KATALOG: (noch leer — du darfst neue Items mit "questmakerItems" anlegen oder nur Text-Belohnungen nutzen.)`;
  }
  const lines = rows.map(
    (r) =>
      `- ${r.category} | ${r.id} | ${r.title}${r.description ? ` — ${String(r.description).slice(0, 160)}` : ''}`
  );
  return `

ITEM_KATALOG (bestehend — bei Treffer dieselbe itemId nutzen; sonst neue Id + vollständiger Eintrag in questmakerItems):
${lines.join('\n')}`;
}

const SYSTEM_PROMPT = `Du hilfst beim Erstellen von Quests für ein persönliches Fortschritts-System — **Inhalt ausschließlich echtes Leben** (Studium, Arbeit, Gesundheit, Behörden, Beziehungen, Reisen, Familie): keine fiktive Handlung, keine Fantasy-Welt als Setting.

Priorität:
1) Wenn dir für sinnvolle, **in der Realität vollständig plausible** Schritte wichtige Fakten fehlen (Ort, Zeitraum, Zielinstitution, …), antworte mit responseType "clarify" und stelle gezielte Rückfragen — nicht raten, nicht halluzinieren.
2) Wenn genug Kontext da ist oder der Nutzer Rückfragen beantwortet hat, liefere responseType "quest" mit strukturierten steps (Gruppen/Unterschritte/Abhängigkeiten wo sinnvoll). Jeder Schritt muss sich im echten Leben so umsetzen lassen, wie beschrieben.

**Ton:** Ermunternd. Quest-Titel, Beschreibung und Schritt-Labels dürfen **metaphorisch, leicht mystisch oder wie ein schöner Buchrand** klingen — bedeutungsvoll, expressiv, manchmal seltsam-im Bild (z. B. ironischer Titel, der die echte Situation trifft). So wird Alltag als lebendig und erwähnenswert gerahmt, ohne nüchtern zu wirken. Vermeide RPG-/Spielwelt-Klischees („Held“, „Dungeon“, „NPC“) und reine Verwaltungssprache.`;

/**
 * @param {string} prompt
 * @param {unknown} clarification
 */
function buildUserMessage(prompt, clarification) {
  if (!clarification || typeof clarification !== 'object') return prompt;
  const pairs = /** @type {any} */ (clarification).pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return prompt;
  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (!p || typeof p !== 'object') continue;
    const q = typeof /** @type {any} */ (p).question === 'string' ? /** @type {any} */ (p).question.trim() : '';
    const a = typeof /** @type {any} */ (p).answer === 'string' ? /** @type {any} */ (p).answer.trim() : '';
    if (q) blocks.push(`Rückfrage: ${q}\nAntwort: ${a || '(leer)'}`);
  }
  if (blocks.length === 0) return prompt;
  return `${prompt.trim()}

---
Vorherige Rückfragen und deine Antworten:
${blocks.join('\n\n')}
---
Bitte jetzt entweder die fertige Quest (responseType "quest") oder weitere Rückfragen (responseType "clarify"), falls immer noch etwas Wesentliches fehlt.`;
}

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * @param {string} username
 * @param {string} model
 * @param {unknown} completion
 */
async function logRpgAiUsage(username, model, completion) {
  try {
    await recordAiUsage({ username, feature: AI_FEATURE_RPG, model, completion });
  } catch (e) {
    console.error('ai_usage_log (rpg quests-generate):', e);
  }
}

/**
 * @param {string} baseId
 * @param {Set<string>} existing
 */
function ensureUniqueQuestId(baseId, existing) {
  let id = baseId || 'quest';
  if (!existing.has(id)) return id;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${id}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${id}-${Date.now()}`;
}

/**
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function coerceStepsArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw;
}

/**
 * POST /api/rpg/quests-generate — KI-Entwurf für eine Quest (nur Superuser).
 * Body: { prompt, existingQuestIds?, lockedQuestId?, clarification?: { pairs: { question, answer }[] } }
 */
export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return forbidden();
  }

  const env = import.meta.env;
  const apiKey = String(env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'KI nicht konfiguriert',
        detail: 'OPENAI_API_KEY fehlt in der Server-Umgebung.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt.length) {
    return new Response(JSON.stringify({ error: 'Bitte eine Beschreibung eingeben.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    return new Response(JSON.stringify({ error: `Text zu lang (max. ${MAX_PROMPT_LEN} Zeichen).` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existingRaw = body?.existingQuestIds;
  const existingSet = new Set(
    Array.isArray(existingRaw) ? existingRaw.filter((x) => typeof x === 'string' && x.trim()) : []
  );

  const lockedRaw = typeof body?.lockedQuestId === 'string' ? body.lockedQuestId.trim() : '';
  const lockedQuestId = lockedRaw ? normalizeQuestId(lockedRaw) : '';

  const model = String(env.RPG_OPENAI_MODEL ?? '').trim() || DEFAULT_MODEL;
  const baseUrl = env.OPENAI_BASE_URL;

  await ensureDbSchema();
  const catalogRows = await listQuestmakerCatalogRows();
  const userContent = buildUserMessage(prompt, body?.clarification);
  const systemContent = SYSTEM_PROMPT + JSON_OBJECT_INSTRUCTION + formatCatalogInstruction(catalogRows);

  let upstream;
  try {
    upstream = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.45,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Netzwerkfehler';
    return new Response(JSON.stringify({ error: 'KI-Anbieter nicht erreichbar', detail: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawText = await upstream.text();
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({
        error: 'KI-Anbieter-Fehler',
        detail: rawText.slice(0, 500),
        status: upstream.status,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let completion;
  try {
    completion = JSON.parse(rawText);
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültige API-Antwort' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await logRpgAiUsage(username, model, completion);

  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return new Response(JSON.stringify({ error: 'Leere Modell-Antwort' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return new Response(JSON.stringify({ error: 'Konnte Quest-JSON nicht parsen' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stepLabels = Array.isArray(parsed.stepLabels) ? parsed.stepLabels : [];
  /** @type {unknown[]} */
  let stepsRaw = coerceStepsArray(parsed.steps);
  const hasStepPayload = stepsRaw.length > 0 || stepLabels.length > 0;
  const questionsFromAi = Array.isArray(parsed.questions)
    ? parsed.questions.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (!hasStepPayload) {
    if (questionsFromAi.length > 0) {
      return new Response(
        JSON.stringify({
          responseType: 'clarify',
          questions: questionsFromAi,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (parsed?.responseType === 'clarify') {
      return new Response(JSON.stringify({ error: 'KI hat keine gültigen Rückfragen geliefert.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (stepsRaw.length === 0 && stepLabels.length > 0) {
    stepsRaw = labelsToSteps(stepLabels.map((x) => String(x)));
  }

  let steps = normalizeQuestStepsTree(stepsRaw);
  if (steps.length === 0 && stepLabels.length > 0) {
    steps = normalizeQuestStepsTree(labelsToSteps(stepLabels.map((x) => String(x))));
  }

  if (steps.length === 0) {
    return new Response(JSON.stringify({ error: 'Die KI hat keine gültigen Schritte geliefert.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const rewardStrings = Array.isArray(parsed.rewards)
    ? parsed.rewards.map((r) => String(r).trim()).filter(Boolean)
    : [];
  let questRewardRows;
  if (Array.isArray(parsed.questRewards) && parsed.questRewards.length > 0) {
    questRewardRows = normalizeQuestRewardRows(parsed.questRewards);
  } else {
    questRewardRows = rewardStrings.map((text) => ({ entry: { type: 'text', text } }));
  }
  const questRewards = questRewardRows.map(questRewardRowToStored);
  const questRewardEntries = questRewardRows.map((r) => r.entry);
  const kind = parsed.kind === 'main' ? 'main' : 'side';

  let nid;
  if (lockedQuestId.length > 0) {
    nid = lockedQuestId;
  } else {
    let fromAi = normalizeQuestId(typeof parsed.id === 'string' ? parsed.id : '');
    if (!fromAi) fromAi = ensureUniqueQuestId('quest', existingSet);
    else fromAi = ensureUniqueQuestId(fromAi, existingSet);
    nid = fromAi;
  }

  const catalogIds = new Set(catalogRows.map((r) => r.id));
  const neededItemIds = collectItemIdsFromStepsAndQuestRewards(steps, questRewardEntries);
  const needsNewDefinition = [...neededItemIds].filter((id) => !catalogIds.has(id));
  /** @type {{ id: string; category: string; title: string; description: string }[]} */
  let questmakerItemsOut = [];
  if (needsNewDefinition.length > 0) {
    const rawQm = Array.isArray(parsed.questmakerItems) ? parsed.questmakerItems : [];
    const normalizedQm = rawQm
      .map((x) => normalizeQuestmakerCatalogPayloadItem(x))
      .filter(Boolean);
    const qmById = new Map(normalizedQm.map((x) => [x.id, x]));
    const missingQm = needsNewDefinition.filter((id) => !qmById.has(id));
    if (missingQm.length > 0) {
      return new Response(
        JSON.stringify({
          error: 'KI muss für neue Item-IDs vollständige questmakerItems liefern.',
          detail: missingQm.join(', '),
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    questmakerItemsOut = needsNewDefinition.map((id) => /** @type {any} */ (qmById.get(id)));
  }

  return new Response(
    JSON.stringify({
      responseType: 'quest',
      id: nid,
      title: title || nid,
      description,
      kind,
      stepLabels: steps.map((s) => s.label),
      steps,
      rewards: rewardStrings,
      questRewards,
      questmakerItems: questmakerItemsOut,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
