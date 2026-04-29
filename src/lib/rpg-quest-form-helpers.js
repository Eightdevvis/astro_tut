/**
 * rpg-quest-form-helpers.js — Hilfsfunktionen fuer Quest-Formulare und API-Generierung.
 *
 * Hinweis (Pass 4 Cleanup, 2026-04-28): Dieser Modul war historisch ein Bauchladen
 * an Editor-Text-Modus-Helpern (linesToNodes, parseNodesFromEditorText,
 * serializeQuestRewardsToEditorText etc.). Mit der Umstellung des Editors auf
 * den Draft-basierten Builder (`RpgQuestNodesBuilder`) wurden diese Funktionen
 * obsolet. Sie sind in Pass 4 entfernt worden — die hier verbliebenen zwei
 * Funktionen sind die einzigen, die noch Verwender haben:
 *
 * - `normalizeQuestId` — vom Editor (Auto-ID aus Titel) verwendet
 * - `labelsToNodes`    — von der Questmaker-API (`quests-generate.js`) verwendet
 *   um KI-erzeugte Stringliste in einfache Nodes zu konvertieren.
 */

/**
 * Normalisiert eine Quest-ID (kleinbuchstaben, Bindestriche statt Spaces, max 48 Zeichen).
 * @param {string} raw
 */
export function normalizeQuestId(raw) {
  let x = raw.trim().toLowerCase().replace(/\s+/g, '-');
  x = x.replace(/[^a-z0-9-_]/g, '');
  return x.slice(0, 48);
}

/**
 * Labels/Titel zu Node-Objekten (fuer KI-Generierung).
 * @param {string[]} titles
 * @returns {{ id: string; title: string }[]}
 */
export function labelsToNodes(titles) {
  /** @type {{ id: string; title: string }[]} */
  const out = [];
  for (const raw of titles) {
    const title = String(raw).trim();
    if (!title) continue;
    out.push({ id: `s-${out.length}`, title });
  }
  return out;
}
