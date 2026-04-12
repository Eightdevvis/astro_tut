import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { listQuestmakerCatalogRows } from '../../../lib/rpg-questmaker-catalog-db.js';
import { normalizeQuestId, labelsToSteps } from '../../../lib/rpg-quest-form-helpers.js';
import { normalizeQuestStepsTree, normalizeQuestRewards } from '../../../lib/rpg-quest-steps.js';

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
- "title": sachlicher Titel (kein Fantasy-Flair)
- "description": 1–3 Sätze Alltag / echtes Leben
- "kind": "main" oder "side"
- "rewards": optional 0–8 kurze Texte ODER weglassen wenn du "questRewards" nutzt
- "questRewards": optional Array von { "type": "text", "text": "…" } oder { "type": "item", "itemId": "…", "displayName": "…" } (itemId nur aus ITEM_KATALOG wenn es passt, sonst Text-Reward)
- "steps": Array aus Schritt-Objekten (siehe unten)

Schritt-Objekt (rekursiv, "substeps" optional):
- "id": kurzer technischer Schlüssel (ascii, eindeutig innerhalb der Quest)
- "label": konkrete Handlung im echten Leben
- "optional": boolean
- "dependsOn": Array von ids anderer Schritte (gleiche Quest), die zuerst erledigt sein müssen; leer [] wenn keine Abhängigkeit
- "reward": optional string ODER { "type": "text", "text": "…" } ODER { "type": "item", "itemId": "…", "displayName": "…" } (item nur mit passender ITEM_KATALOG-Zeile)
- "timeDueAt": optional ISO-Datum "YYYY-MM-DD" nur wenn eine echte Frist sinnvoll ist (z. B. Bewerbungsende)
- "substeps": optional Array weiterer Schritt-Objekte für Gruppen (Unterschritte)

Nutze "substeps" und "dependsOn", wenn die Aufgabe nicht nur eine flache Liste ist. Keine Fantasy-Begriffe (keine Elfen, Mana, Questgeber im Sinne von RPG).

Wenn ITEM_KATALOG leer ist oder kein Item passt: nutze nur Text-Rewards (type "text" oder kurze Strings in "rewards").`;

/** @param {{ id: string; category: string; title: string; description: string }[]} rows */
function formatCatalogInstruction(rows) {
  if (!rows.length) {
    return `

ITEM_KATALOG: (noch leer — nutze nur Text-Belohnungen in "rewards" / type "text".)`;
  }
  const lines = rows.map(
    (r) =>
      `- ${r.category} | ${r.id} | ${r.title}${r.description ? ` — ${String(r.description).slice(0, 160)}` : ''}`
  );
  return `

ITEM_KATALOG (bestehend — für type "item" nur itemId verwenden, wenn Titel/Beschreibung zur Quest passen; sonst Text-Reward):
${lines.join('\n')}`;
}

const SYSTEM_PROMPT = `Du hilfst beim Erstellen von Quests für ein persönliches Fortschritts-System — Inhalt = echtes Leben (Studium, Arbeit, Gesundheit, Behörden, Beziehungen), keine Fantasy-Welt.

Priorität:
1) Wenn dir für sinnvolle, konkrete Schritte wichtige Fakten fehlen (Ort, Zeitraum, Zielinstitution, …), antworte mit responseType "clarify" und stelle gezielte Rückfragen — nicht raten, nicht halluzinieren.
2) Wenn genug Kontext da ist oder der Nutzer Rückfragen beantwortet hat, liefere responseType "quest" mit strukturierten steps (Gruppen/Unterschritte/Abhängigkeiten wo sinnvoll).

Ton: nüchtern, ermutigend, ohne Spielwelt-Metaphern in Titel und Beschreibung (kein „Held“, „Dungeon“, „NPC“).`;

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
  let questRewards;
  if (Array.isArray(parsed.questRewards) && parsed.questRewards.length > 0) {
    questRewards = normalizeQuestRewards(parsed.questRewards);
  } else {
    questRewards = rewardStrings.map((text) => ({ type: 'text', text }));
  }
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
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
