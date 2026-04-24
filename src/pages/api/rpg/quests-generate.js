import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import {
  listQuestmakerCatalogRows,
  searchQuestmakerCatalogCandidates,
} from '../../../lib/rpg-questmaker-catalog-db.js';
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
const MAX_CLARIFY_ROUNDS = 2;
const MAX_PACKAGE_QUESTS = 16;
const MAX_LOOKUP_REQUESTS = 24;
const MAX_LOOKUP_CANDIDATES = 6;
const RPG_QUESTMAKER_ENABLED = false;

const PLACEHOLDER_PATTERNS = [
  /\betc\b/i,
  /\bund\s+so\s+weiter\b/i,
  /\birgendwie\b/i,
  /\bspäter\b/i,
  /\bwhatever\b/i,
  /\bthing\b/i,
  /\bstuff\b/i,
];

const GENERIC_PATTERNS = [
  /\bsetup\b/i,
  /\bresearch\b/i,
  /\bcollect\b/i,
  /\bgather\b/i,
  /\bplan\b/i,
  /\borganize\b/i,
  /\bimplement\b/i,
  /\bdo\b/i,
];

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

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown, kein Code-Fence). Pflicht-Top-Level-Key: "responseType" mit dem Wert "clarify" oder "quest" (optional "package", falls unten aktiviert).

Wenn "responseType":"clarify":
- "questions": Array von 1–6 kurzen Rückfragen auf Deutsch (was dir für eine realistische Quest noch fehlt: Ort, Datum, Institution, Budget, …).

Wenn "responseType":"quest":
- "id": kurzer Slug (Kleinbuchstaben, Bindestriche, max. 48 Zeichen)
- "title": prägnant; darf metaphorisch, leicht rätselhaft oder ironisch klingen (wie ein Randtitel), muss sich aber auf die **echte** Situation aus dem Nutzer-Prompt beziehen — keine fiktive Handlung, keine Fantasy-Welt
- "description": 1–3 Sätze über **echtes** Leben; Stil wie der Rand einer gut geschriebenen Geschichte: expressiv, warm oder leicht mystisch, wo es passt — nicht trocken oder rein verwaltungsmäßig
- "rewards": optional 0–8 kurze Texte ODER weglassen wenn du "questRewards" nutzt
- "questRewards": optional Array von { "type": "text", "text": "…" } oder { "type": "item", "itemId": "…", "displayName": "…" } oder { "type": "points", "pointKind": "heart"|"mana", "amount": Ganzzahl } (amount darf negativ sein); optional pro Eintrag "unlockAtPercent": Ganzzahl 0–100 (Freischaltung ab Quest-Fortschritt %); weglassen = automatische Verteilung wie im Editor
- "children": Array aus Schritt-Objekten (siehe unten)
- "itemLookupRequests": optionales Array (max ${MAX_LOOKUP_REQUESTS}) für jede unklare Item-Wahl: { "itemId": "slug", "name": "gesuchter Name", "keywords": ["..."], "reason": "kurz" }.
  Nutze hier echte Suchbegriffe. Die finale Katalog-Auflösung macht der Server in einem separaten Schritt.

Schritt-Objekt (rekursiv, "children" optional):
- "id": kurzer technischer Schlüssel (ascii, eindeutig innerhalb der Quest)
- "label": **konkrete, in der Realität vollständig nachvollziehbare Handlung** (klar genug zum Umsetzen: was, wo, mit wem — keine Halluzination). Formulierung darf bildhaft oder leicht mystisch sein, darf aber nicht verschleiern, was zu tun ist
- "optional": boolean
- "dependsOn": Array von ids anderer Schritte (gleiche Quest), die zuerst erledigt sein müssen; leer [] wenn keine Abhängigkeit
- "reward": optional string ODER { "type": "text", "text": "…" } ODER { "type": "item", "itemId": "…", "displayName": "…" } ODER { "type": "points", "pointKind": "heart"|"mana", "amount": Ganzzahl } — bei neuer itemId Eintrag in "questmakerItems" (siehe oben). Für Punkte: heart = körperliche Herzpunkte (z. B. Bewegung: plus, Belastung: minus); mana = geistige Manapunkte (Lernen/Konzentration oft minus, Erholung plus — je nach Schritt sinnvoll setzen).
- "timeDueAt": optional ISO-Datum "YYYY-MM-DD" nur wenn eine echte Frist sinnvoll ist (z. B. Bewerbungsende)
- "children": optional Array weiterer Schritt-Objekte für Gruppen (Unterschritte)

Nutze "children" und "dependsOn", wenn die Aufgabe nicht nur eine flache Liste ist. **Inhalt** immer echtes Leben des Nutzers — keine erfundene Quest, keine Spielwelt. **Sprache** darf Alltag als bedeutsam, spannend oder fast magisch rahmen (Metaphern, leichte Mystik), aber ohne RPG-Klischees wie „Held“, „Dungeon“, „NPC“. Die internen Reward-Typen "heart"/"mana" bei "points" sind erlaubt (Symbole in der UI).

Qualitätsregeln (verbindlich):
- Keine Platzhalter oder reine Sammelphrasen ("etc", "do stuff", "später", ...).
- Jeder Leaf-Step beschreibt eine nachvollziehbare reale Aktion (was wird erzeugt, geprüft oder eingereicht).
- Bei Sammelpunkten nutze children mit überprüfbaren Outcomes.
- Bei fehlenden Kernfakten zuerst "clarify", nicht raten.`;

const JSON_OBJECT_INSTRUCTION_PACKAGE = `

Optional kannst du bei komplexen Vorhaben statt einer Einzelquest ein Paket liefern:
- "responseType":"package"
- "packageType":"subsection"
- "title": Titel des Unterabschnitt-Pakets
- "description": kurze Paketbeschreibung
- "quests": Array von 1 bis ${MAX_PACKAGE_QUESTS} Quest-Objekten (gleiches Quest-Shape wie bei responseType "quest")
- "edges": optionale Array von { "from":"questId", "to":"questId" } zwischen Quests im Paket
- "unlockHints": optionales Array kurzer Hinweise für grobe Container-Unlocks (nur Hinweise, keine persistenten Regeln)
- "itemLookupRequests": optional wie oben, quer über alle Quests.
`;

const SYSTEM_PROMPT = `Du hilfst beim Erstellen von Quests für ein persönliches Fortschritts-System — **Inhalt ausschließlich echtes Leben** (Studium, Arbeit, Gesundheit, Behörden, Beziehungen, Reisen, Familie): keine fiktive Handlung, keine Fantasy-Welt als Setting.

Priorität:
1) Wenn dir für sinnvolle, **in der Realität vollständig plausible** Schritte wichtige Fakten fehlen (Ort, Zeitraum, Zielinstitution, …), antworte mit responseType "clarify" und stelle gezielte Rückfragen — nicht raten, nicht halluzinieren.
2) Wenn genug Kontext da ist oder der Nutzer Rückfragen beantwortet hat, liefere responseType "quest" mit strukturierten steps (Gruppen/Unterschritte/Abhängigkeiten wo sinnvoll). Jeder Schritt muss sich im echten Leben so umsetzen lassen, wie beschrieben.

**Ton:** Ermunternd. Quest-Titel, Beschreibung und Schritt-Labels dürfen metaphorisch sein, müssen aber handlungsleitend und konkret bleiben. Vermeide RPG-/Spielwelt-Klischees („Held“, „Dungeon“, „NPC“) und reine Verwaltungssprache.`;

const ITEM_RESOLUTION_PROMPT = `Du löst Item-Referenzen für Quest-Rewards auf.
Du erhältst:
1) unresolvedItems: Liste aus itemId/name/keywords
2) candidatesByItemId: je unresolved itemId 0..${MAX_LOOKUP_CANDIDATES} Katalogkandidaten

Antworte NUR JSON:
{
  "resolutions": [
    {
      "itemId": "unresolved-id",
      "selectedExistingItemId": "catalog-id" | null,
      "createNewItem": { "id": "...", "category": "alltag|studium|arbeit|gesundheit|beziehungen|organisation|sonstiges", "title": "...", "description": "..." } | null
    }
  ]
}

Regeln:
- Wenn ein Kandidat klar passt: selectedExistingItemId setzen.
- Wenn keiner passt: createNewItem vollständig ausfüllen.
- Genau eine der beiden Varianten pro Resolution nutzen.
- Niemals freie Texte außerhalb JSON ausgeben.`;

/**
 * @param {string} code
 * @param {string} message
 * @param {string} [hint]
 * @param {number} [status]
 */
function jsonError(code, message, hint, status = 400) {
  return new Response(
    JSON.stringify({
      errorCode: code,
      error: message,
      message,
      ...(hint ? { hint } : {}),
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * @param {import('../../../lib/rpg-quest-steps.js').RpgQuestStepNode[]} steps
 */
function countLeafSteps(steps) {
  let n = 0;
  const walk = (arr) => {
    for (const s of arr || []) {
      if (Array.isArray(s.children) && s.children.length > 0) walk(s.children);
      else n += 1;
    }
  };
  walk(steps);
  return n;
}

/**
 * @param {import('../../../lib/rpg-quest-steps.js').RpgQuestStepNode[]} steps
 */
function hasNestedSubsteps(steps) {
  const walk = (arr, depth) => {
    for (const s of arr || []) {
      const subs = Array.isArray(s.children) ? s.children : [];
      if (subs.length > 0 && depth >= 1) return true;
      if (walk(subs, depth + 1)) return true;
    }
    return false;
  };
  return walk(steps, 0);
}

/**
 * @param {import('../../../lib/rpg-quest-steps.js').RpgQuestStepNode[]} steps
 */
function collectLeafLabels(steps) {
  /** @type {string[]} */
  const out = [];
  const walk = (arr) => {
    for (const s of arr || []) {
      const subs = Array.isArray(s.children) ? s.children : [];
      if (subs.length > 0) walk(subs);
      else out.push(String(s.label || '').trim());
    }
  };
  walk(steps);
  return out;
}

/**
 * @param {import('../../../lib/rpg-quest-steps.js').RpgQuestStepNode[]} steps
 * @param {string} prompt
 */
function assessQuestStepQuality(steps, prompt) {
  const leaves = collectLeafLabels(steps);
  const hasPlaceholder = leaves.some((label) => PLACEHOLDER_PATTERNS.some((re) => re.test(label)));
  const noConcreteLeaf = leaves.some((label) => {
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length >= 3) return false;
    return !/\b(antrag|mail|formular|termin|liste|dokument|test|check|abgabe|kauf|call|ticket)\b/i.test(label);
  });
  const hasShallowShape = countLeafSteps(steps) < 4 && !hasNestedSubsteps(steps);
  const hasOnlyGeneric =
    leaves.length > 0 &&
    leaves.every((label) => {
      const lowered = label.toLowerCase();
      return GENERIC_PATTERNS.some((re) => re.test(lowered));
    });
  const tooFlatForComplex = hasShallowShape && (prompt.length > 220 || leaves.length >= 4);
  return { hasPlaceholder, noConcreteLeaf, tooFlatForComplex, hasOnlyGeneric };
}

/**
 * @param {string} apiKey
 * @param {string | undefined} baseUrl
 * @param {string} model
 * @param {{ role: 'system' | 'user'; content: string }[]} messages
 * @param {number} [temperature]
 */
async function requestJsonCompletion(apiKey, baseUrl, model, messages, temperature = 0.35) {
  const upstream = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
      response_format: { type: 'json_object' },
    }),
  });
  const rawText = await upstream.text();
  if (!upstream.ok) {
    const err = new Error(`KI-Anbieter-Fehler (${upstream.status}): ${rawText.slice(0, 500)}`);
    // @ts-ignore - lightweight error metadata
    err.statusCode = upstream.status;
    throw err;
  }
  const completion = JSON.parse(rawText);
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Leere Modell-Antwort');
  }
  const parsed = JSON.parse(content);
  return { completion, parsed };
}

/**
 * @param {unknown} raw
 */
function normalizeLookupRequest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const itemId = typeof o.itemId === 'string' ? o.itemId.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
    : [];
  if (!itemId && !name && keywords.length === 0) return null;
  return { itemId, name, reason, keywords };
}

/**
 * @param {import('../../../lib/rpg-quest-steps.js').RpgQuestStepNode[]} steps
 * @param {ReturnType<typeof normalizeQuestRewardRows>} questRewardRows
 * @param {Map<string, string>} idMap
 */
function remapItemIdsInQuest(steps, questRewardRows, idMap) {
  const walk = (arr) => {
    for (const s of arr || []) {
      if (s?.reward && typeof s.reward === 'object' && s.reward.type === 'item' && idMap.has(s.reward.itemId)) {
        s.reward.itemId = /** @type {string} */ (idMap.get(s.reward.itemId));
      }
      if (Array.isArray(s?.children) && s.children.length > 0) walk(s.children);
    }
  };
  walk(steps);
  for (const row of questRewardRows) {
    const entry = row?.entry;
    if (entry?.type === 'item' && idMap.has(entry.itemId)) {
      entry.itemId = /** @type {string} */ (idMap.get(entry.itemId));
    }
  }
}

/**
 * @param {Map<string, { itemId: string; name: string; keywords: string[]; reason: string }>} unresolvedMap
 * @param {Array<{ itemId?: string; name?: string; keywords?: string[]; reason?: string }>} lookupRequests
 */
function mergeLookupRequests(unresolvedMap, lookupRequests) {
  for (const req of lookupRequests) {
    const id = String(req?.itemId || '').trim();
    if (!id || !unresolvedMap.has(id)) continue;
    const prev = /** @type {{ itemId: string; name: string; keywords: string[]; reason: string }} */ (unresolvedMap.get(id));
    const nextName = String(req?.name || '').trim();
    const nextReason = String(req?.reason || '').trim();
    const nextKeywords = Array.isArray(req?.keywords) ? req.keywords.map((x) => String(x).trim()).filter(Boolean) : [];
    unresolvedMap.set(id, {
      itemId: id,
      name: nextName || prev.name,
      reason: nextReason || prev.reason,
      keywords: [...new Set([...(prev.keywords || []), ...nextKeywords])].slice(0, 10),
    });
  }
}

/**
 * @param {{
 *   unresolved: { itemId: string; name: string; keywords: string[]; reason: string }[];
 *   lookupRequests: { itemId: string; name: string; reason: string; keywords: string[] }[];
 *   apiKey: string;
 *   baseUrl: string | undefined;
 *   model: string;
 * }} params
 */
async function resolveUnknownItemsForResponse(params) {
  /** @type {Map<string, { itemId: string; name: string; keywords: string[]; reason: string }>} */
  const unresolvedMap = new Map(params.unresolved.map((x) => [x.itemId, x]));
  mergeLookupRequests(unresolvedMap, params.lookupRequests);
  const unresolved = [...unresolvedMap.values()];
  /** @type {Record<string, { id: string; category: string; title: string; description: string }[]>} */
  const candidatesByItemId = {};
  for (const req of unresolved) {
    const candidates = await searchQuestmakerCatalogCandidates({
      proposedItemId: req.itemId,
      name: req.name,
      keywords: req.keywords,
      limit: MAX_LOOKUP_CANDIDATES,
    });
    candidatesByItemId[req.itemId] = candidates.map((x) => ({
      id: x.id,
      category: x.category,
      title: x.title,
      description: x.description,
    }));
  }

  let completion;
  let parsed;
  try {
    const resolution = await requestJsonCompletion(
      params.apiKey,
      params.baseUrl,
      params.model,
      [
        { role: 'system', content: ITEM_RESOLUTION_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            unresolvedItems: unresolved,
            candidatesByItemId,
          }),
        },
      ],
      0.2
    );
    completion = resolution.completion;
    parsed = resolution.parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'resolution_failed';
    return { ok: false, error: jsonError('item_resolution_failed', 'Item-Auflösung durch KI fehlgeschlagen.', String(msg).slice(0, 500), 502) };
  }

  const rawRows = Array.isArray(parsed?.resolutions) ? parsed.resolutions : [];
  /** @type {Map<string, string>} */
  const remap = new Map();
  /** @type {{ id: string; category: string; title: string; description: string }[]} */
  const newItems = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const itemId = typeof raw.itemId === 'string' ? raw.itemId.trim() : '';
    if (!itemId || !unresolvedMap.has(itemId)) continue;
    const picked = typeof raw.selectedExistingItemId === 'string' ? raw.selectedExistingItemId.trim() : '';
    if (picked) {
      const exists = (candidatesByItemId[itemId] || []).some((x) => x.id === picked);
      if (!exists) {
        return {
          ok: false,
          error: jsonError(
            'item_lookup_ambiguous',
            `KI hat unzulässigen Kandidaten für ${itemId} gewählt.`,
            'Bitte Prompt präzisieren oder erneut generieren.',
            502
          ),
        };
      }
      remap.set(itemId, picked);
      continue;
    }
    const created = normalizeQuestmakerCatalogPayloadItem(raw.createNewItem);
    if (created) {
      newItems.push(created);
      remap.set(itemId, created.id);
    }
  }

  const unresolvedAfter = unresolved.filter((x) => !remap.has(x.itemId));
  if (unresolvedAfter.length > 0) {
    return {
      ok: false,
      error: jsonError(
        'item_lookup_no_candidates',
        'Nicht alle Item-Referenzen konnten aufgelöst werden.',
        unresolvedAfter.map((x) => x.itemId).join(', '),
        400
      ),
    };
  }
  return { ok: true, remap, newItems, completion };
}

/**
 * @param {string} prompt
 * @param {number} clarifyRounds
 */
function buildFallbackClarifyQuestions(prompt, clarifyRounds) {
  if (clarifyRounds >= MAX_CLARIFY_ROUNDS) return [];
  const hasDate = /\b\d{4}-\d{2}-\d{2}\b/.test(prompt);
  const out = [
    'Welches konkrete Ergebnis muss am Ende vorliegen (Dokument, Abgabe, Entscheidung, Termin)?',
    'Welche festen Rahmenbedingungen gelten bereits (Zeit, Budget, Ort, vorhandene Mittel)?',
    hasDate
      ? 'Welche Teile sind bis zum genannten Datum zwingend fertig?'
      : 'Gibt es eine feste Frist oder einen Stichtag?',
  ];
  return out.slice(0, 3);
}

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
 * POST /api/rpg/quests-generate — KI-Entwurf für eine Quest (rpg_access).
 * Body: { prompt, existingQuestIds?, lockedQuestId?, clarification?: { pairs: { question, answer }[] } }
 */
export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  const hasRpgAccess = username ? await hasPermission(username, 'rpg_access') : false;
  if (!username || !hasRpgAccess) {
    return forbidden();
  }
  if (!RPG_QUESTMAKER_ENABLED) {
    return jsonError(
      'questmaker_disabled',
      'Questmaker ist derzeit deaktiviert.',
      'Aktuell sind nur manuelle Quest-Aenderungen verfuegbar.',
      503
    );
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
  const clarificationPairs =
    body?.clarification &&
    typeof body.clarification === 'object' &&
    Array.isArray(body.clarification.pairs)
      ? body.clarification.pairs.filter((x) => x && typeof x === 'object')
      : [];
  const clarifyRounds = clarificationPairs.length;
  const allowPackage = body?.mode === 'subsection' || body?.responseMode === 'package';
  const usePackageMode = allowPackage && !lockedQuestId;

  const model = String(env.RPG_OPENAI_MODEL ?? '').trim() || DEFAULT_MODEL;
  const baseUrl = env.OPENAI_BASE_URL;

  await ensureDbSchema();
  const catalogRows = await listQuestmakerCatalogRows();
  const userContent = buildUserMessage(prompt, body?.clarification);
  const systemContent =
    SYSTEM_PROMPT +
    JSON_OBJECT_INSTRUCTION +
    (usePackageMode ? JSON_OBJECT_INSTRUCTION_PACKAGE : '');

  let completion;
  let parsed;
  try {
    const first = await requestJsonCompletion(
      apiKey,
      baseUrl,
      model,
      [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      0.45
    );
    completion = first.completion;
    parsed = first.parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Netzwerkfehler';
    return new Response(JSON.stringify({ error: 'KI-Anbieter nicht erreichbar', detail: String(msg).slice(0, 500) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await logRpgAiUsage(username, model, completion);

  const stepLabels = Array.isArray(parsed.stepLabels) ? parsed.stepLabels : [];
  /** @type {unknown[]} */
  let stepsRaw = coerceStepsArray(Array.isArray(parsed.children) ? parsed.children : parsed.steps);
  const hasStepPayload = stepsRaw.length > 0 || stepLabels.length > 0;
  const questionsFromAi = Array.isArray(parsed.questions)
    ? parsed.questions.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const lookupRequests = Array.isArray(parsed.itemLookupRequests)
    ? parsed.itemLookupRequests.map((x) => normalizeLookupRequest(x)).filter(Boolean).slice(0, MAX_LOOKUP_REQUESTS)
    : [];

  if (!hasStepPayload) {
    if (questionsFromAi.length > 0) {
      if (clarifyRounds >= MAX_CLARIFY_ROUNDS) {
        return jsonError(
          'clarify_limit_reached',
          'Maximale Anzahl an Rückfragen erreicht. Bitte mehr konkrete Details im Prompt angeben.',
          'Nenne feste Randbedingungen (Zeit, Budget, vorhandene Ressourcen), damit direkt eine Quest erzeugt werden kann.',
          400
        );
      }
      return new Response(
        JSON.stringify({
          responseType: 'clarify',
          questions: questionsFromAi,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (parsed?.responseType === 'clarify') {
      return jsonError(
        'invalid_clarify_payload',
        'KI hat keine gültigen Rückfragen geliefert.',
        'Bitte Prompt präzisieren und erneut generieren.',
        502
      );
    }
  }

  if (parsed?.responseType === 'package' && usePackageMode) {
    const rawQuests = Array.isArray(parsed.quests) ? parsed.quests : [];
    if (rawQuests.length === 0) {
      return jsonError(
        'invalid_package_payload',
        'KI-Paket enthält keine Quests.',
        'Beschreibe den Unterabschnitt konkreter und gib Ziel, Umfang und vorhandene Ressourcen an.',
        502
      );
    }
    if (rawQuests.length > MAX_PACKAGE_QUESTS) {
      return jsonError(
        'package_too_large',
        `KI-Paket enthält zu viele Quests (max. ${MAX_PACKAGE_QUESTS}).`,
        'Bitte den Unterabschnitt enger fassen.',
        400
      );
    }
    /** @type {any[]} */
    const outQuests = [];
    /** @type {Map<string, any>} */
    const byId = new Map();
    const allNeedItemIds = new Set();
    for (let i = 0; i < rawQuests.length; i++) {
      const q = rawQuests[i] && typeof rawQuests[i] === 'object' ? rawQuests[i] : {};
      const qTitle = typeof q.title === 'string' ? q.title.trim() : '';
      const qDesc = typeof q.description === 'string' ? q.description.trim() : '';
      const qStepLabels = Array.isArray(q.stepLabels) ? q.stepLabels : [];
      let qStepsRaw = coerceStepsArray(Array.isArray(q.children) ? q.children : q.steps);
      if (qStepsRaw.length === 0 && qStepLabels.length > 0) {
        qStepsRaw = labelsToSteps(qStepLabels.map((x) => String(x)));
      }
      let qSteps = normalizeQuestStepsTree(qStepsRaw);
      if (qSteps.length === 0) {
        return jsonError(
          'package_invalid_steps',
          `Quest ${i + 1} im Paket enthält keine gültigen Schritte.`,
          'Erzeuge pro Quest konkrete Leaf-Steps oder children.',
          502
        );
      }
      const qQuality = assessQuestStepQuality(qSteps, prompt);
      if (qQuality.hasPlaceholder || qQuality.hasOnlyGeneric) {
        return jsonError(
          'package_placeholder_steps',
          `Quest ${i + 1} im Paket enthält Platzhalter-Schritte.`,
          'Nutze konkrete Handlungen statt generischer Sammelphrasen.',
          400
        );
      }
      const qRewardStrings = Array.isArray(q.rewards)
        ? q.rewards.map((r) => String(r).trim()).filter(Boolean)
        : [];
      const qRewardRows =
        Array.isArray(q.questRewards) && q.questRewards.length > 0
          ? normalizeQuestRewardRows(q.questRewards)
          : qRewardStrings.map((text) => ({ entry: { type: 'text', text } }));
      const qQuestRewards = qRewardRows.map(questRewardRowToStored);
      const qQuestRewardEntries = qRewardRows.map((r) => r.entry);
      const qCatalogNeed = collectItemIdsFromStepsAndQuestRewards(qSteps, qQuestRewardEntries);
      for (const id of qCatalogNeed) allNeedItemIds.add(id);
      const rawId = normalizeQuestId(typeof q.id === 'string' ? q.id : '');
      const uniqueId =
        rawId && !byId.has(rawId) ? rawId : ensureUniqueQuestId(rawId || `pkg-quest-${i + 1}`, new Set(byId.keys()));
      const outQuest = {
        id: uniqueId,
        parentId: null,
        title: qTitle || uniqueId,
        description: qDesc,
        stepLabels: qSteps.map((s) => s.label),
        children: normalizeQuestStepsTree(qSteps, uniqueId),
        rewards: qRewardStrings,
        questRewards: qQuestRewards,
      };
      byId.set(uniqueId, outQuest);
      outQuests.push(outQuest);
    }
    const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    const outEdges = rawEdges
      .map((e) => (e && typeof e === 'object' ? e : null))
      .filter(Boolean)
      .map((e) => ({ from: String(e.from || '').trim(), to: String(e.to || '').trim() }))
      .filter((e) => e.from && e.to && byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
    const catalogIds = new Set(catalogRows.map((r) => r.id));
    const needsNewDefinition = [...allNeedItemIds].filter((id) => !catalogIds.has(id));
    /** @type {{ id: string; category: string; title: string; description: string }[]} */
    let questmakerItemsOut = [];
    if (needsNewDefinition.length > 0) {
      const unresolved = needsNewDefinition.map((id) => ({
        itemId: id,
        name: id.replace(/-/g, ' '),
        keywords: [],
        reason: 'package-reward-item',
      }));
      const resolved = await resolveUnknownItemsForResponse({
        unresolved,
        lookupRequests,
        apiKey,
        baseUrl,
        model,
      });
      if (!resolved.ok) return resolved.error;
      await logRpgAiUsage(username, model, resolved.completion);
      for (const q of outQuests) {
        const qRows = normalizeQuestRewardRows(q.questRewards || []);
        remapItemIdsInQuest(q.children || [], qRows, resolved.remap);
        q.questRewards = qRows.map(questRewardRowToStored);
      }
      questmakerItemsOut = resolved.newItems;
    }
    return new Response(
      JSON.stringify({
        responseType: 'package',
        packageType: 'subsection',
        title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
        description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
        quests: outQuests,
        edges: outEdges,
        unlockHints: Array.isArray(parsed.unlockHints)
          ? parsed.unlockHints.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
          : [],
        questmakerItems: questmakerItemsOut,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (stepsRaw.length === 0 && stepLabels.length > 0) {
    stepsRaw = labelsToSteps(stepLabels.map((x) => String(x)));
  }

  let steps = normalizeQuestStepsTree(stepsRaw);
  if (steps.length === 0 && stepLabels.length > 0) {
    steps = normalizeQuestStepsTree(labelsToSteps(stepLabels.map((x) => String(x))));
  }

  if (steps.length === 0) {
    return jsonError(
      'invalid_steps',
      'Die KI hat keine gültigen Schritte geliefert.',
      'Bitte gib Ziel, Kontext und konkrete Randbedingungen an.',
      502
    );
  }

  const quality = assessQuestStepQuality(steps, prompt);
  if (quality.hasPlaceholder || quality.hasOnlyGeneric) {
    const fallbackQuestions = buildFallbackClarifyQuestions(prompt, clarifyRounds);
    if (fallbackQuestions.length > 0) {
      return new Response(
        JSON.stringify({
          responseType: 'clarify',
          questions: fallbackQuestions,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return jsonError(
      'quality_placeholder_steps',
      'Die KI hat zu generische Platzhalter-Schritte geliefert.',
      'Bitte nenne konkrete Teilaufgaben, vorhandene Ressourcen und gewünschte Ergebnisse.',
      400
    );
  }
  if (quality.tooFlatForComplex) {
    const fallbackQuestions = buildFallbackClarifyQuestions(prompt, clarifyRounds);
    if (fallbackQuestions.length > 0) {
      return new Response(
        JSON.stringify({
          responseType: 'clarify',
          questions: fallbackQuestions,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return jsonError(
      'quality_too_flat',
      'Die Quest-Struktur ist für das Vorhaben zu flach.',
      'Bitte fordere children pro Hauptblock (z. B. Beschaffung, Setup, Implementierung, Test).',
      400
    );
  }
  if (quality.noConcreteLeaf) {
    return jsonError(
      'quality_leaf_not_concrete',
      'Mindestens ein Schritt ist nicht konkret genug.',
      'Formuliere Leaf-Steps mit überprüfbarer Aktion und klarem Objekt/Ziel.',
      400
    );
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
  steps = normalizeQuestStepsTree(steps, nid);
  const neededItemIds = collectItemIdsFromStepsAndQuestRewards(steps, questRewardEntries);
  const needsNewDefinition = [...neededItemIds].filter((id) => !catalogIds.has(id));
  /** @type {{ id: string; category: string; title: string; description: string }[]} */
  let questmakerItemsOut = [];
  if (needsNewDefinition.length > 0) {
    const unresolved = needsNewDefinition.map((id) => ({
      itemId: id,
      name: id.replace(/-/g, ' '),
      keywords: [],
      reason: 'quest-reward-item',
    }));
    const resolved = await resolveUnknownItemsForResponse({
      unresolved,
      lookupRequests,
      apiKey,
      baseUrl,
      model,
    });
    if (!resolved.ok) return resolved.error;
    await logRpgAiUsage(username, model, resolved.completion);
    remapItemIdsInQuest(steps, questRewardRows, resolved.remap);
    questRewards.length = 0;
    for (const row of questRewardRows.map(questRewardRowToStored)) questRewards.push(row);
    questmakerItemsOut = resolved.newItems;
  }

  return new Response(
    JSON.stringify({
      responseType: 'quest',
      id: nid,
      parentId: null,
      title: title || nid,
      description,
      stepLabels: steps.map((s) => s.label),
      children: steps,
      rewards: rewardStrings,
      questRewards,
      questmakerItems: questmakerItemsOut,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
