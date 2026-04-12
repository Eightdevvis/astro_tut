import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { normalizeQuestId, labelsToSteps } from '../../../lib/rpg-quest-form-helpers.js';

const MAX_PROMPT_LEN = 6000;
const DEFAULT_MODEL = 'gpt-4o-mini';

/** @param {string | undefined} raw */
function chatCompletionsUrl(raw) {
  const base = (raw?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

/** Wenn kein json_schema (z. B. DeepSeek): nur json_object — Prompt ergänzt das Format. */
const JSON_OBJECT_PROMPT_SUFFIX = `

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown). Pflicht-Keys exakt: "id", "title", "description", "stepLabels" (Array, mindestens ein String), "rewards" (Array von Strings), "kind" ("main" oder "side").`;

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

/** OpenAI Chat Completions — strukturiertes JSON */
const QUEST_JSON_SCHEMA = {
  name: 'rpg_quest_draft',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      stepLabels: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
      },
      rewards: {
        type: 'array',
        items: { type: 'string' },
      },
      kind: { type: 'string', enum: ['main', 'side'] },
    },
    required: ['id', 'title', 'description', 'stepLabels', 'rewards', 'kind'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `Du bist ein Assistent für ein RPG-Quest-System. Der Nutzer beschreibt eine Quest-Idee; du erzeugst einen strukturierten Entwurf auf Deutsch.

Regeln:
- id: kurzer eindeutiger Slug (Kleinbuchstaben, Bindestriche, max. 48 Zeichen), passend zur Idee.
- title: kurzer, spielerisch passender Titel.
- description: 1–3 Sätze Fließtext (keine Aufzählung im Fließtext).
- stepLabels: 1–8 konkrete Spielerschritte, je eine kurze Zeile (Verbform oder kurzer Imperativ).
- rewards: 1–5 kurze Belohnungen (Items, XP, Titel — passend zum Ton der Seite).
- kind: "main" für Haupthandlung / größere Story, "side" für Nebenquest.

Antworte nur mit JSON gemäß Schema, ohne Markdown.`;

/**
 * POST /api/rpg/quests-generate — KI-Entwurf für eine neue Quest (nur Superuser).
 * Body: { prompt: string, existingQuestIds?: string[] }
 */
export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return forbidden();
  }

  /** Wie `db.js` / JWT: Astro+Vercel liefern Secrets zuverlässig über `import.meta.env`; `process.env` ist im Server-Bundle oft leer. */
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

  const model = String(env.RPG_OPENAI_MODEL ?? '').trim() || DEFAULT_MODEL;
  const baseUrl = env.OPENAI_BASE_URL;
  const useJsonSchema =
    env.RPG_OPENAI_USE_JSON_SCHEMA !== '0' &&
    String(env.RPG_OPENAI_USE_JSON_SCHEMA ?? '').toLowerCase() !== 'false';

  const systemContent = useJsonSchema ? SYSTEM_PROMPT : SYSTEM_PROMPT + JSON_OBJECT_PROMPT_SUFFIX;
  const responseFormat = useJsonSchema
    ? { type: 'json_schema', json_schema: QUEST_JSON_SCHEMA }
    : { type: 'json_object' };

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
        temperature: 0.65,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt },
        ],
        response_format: responseFormat,
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
  const steps = labelsToSteps(stepLabels);
  if (steps.length === 0) {
    return new Response(JSON.stringify({ error: 'Die KI hat keine gültigen Schritte geliefert.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const rewards = Array.isArray(parsed.rewards)
    ? parsed.rewards.map((r) => String(r).trim()).filter(Boolean)
    : [];
  const kind = parsed.kind === 'main' ? 'main' : 'side';

  let nid = normalizeQuestId(typeof parsed.id === 'string' ? parsed.id : '');
  if (!nid) {
    nid = ensureUniqueQuestId('quest', existingSet);
  } else {
    nid = ensureUniqueQuestId(nid, existingSet);
  }

  return new Response(
    JSON.stringify({
      id: nid,
      title: title || nid,
      description,
      kind,
      stepLabels: steps.map((s) => s.label),
      rewards,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
