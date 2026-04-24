/**
 * Default-/Sample-Quests und Kanon-Form für GET /api/rpg/quests.
 * Später: gleiche Struktur von KI oder DB liefern lassen.
 */

/** @typedef {import('./rpg-quest-steps.js').RpgQuestStepNode} RpgQuestStep */
/** @typedef {import('./rpg-quest-steps.js').RpgQuestRewardEntry} RpgQuestRewardEntry */
/** @typedef {{ id: string; parentId: null; title: string; description: string; children: RpgQuestStep[]; rewards?: string[] }} RpgQuest */
/** @typedef {{ main: RpgQuest[]; side: RpgQuest[] }} RpgQuestPayloadLegacy */
/** @typedef {{ id: string; parentId: null; title: string; description: string; cityLocation?: string; children: RpgQuestStep[]; rewards?: string[]; questRewards?: RpgQuestRewardEntry[]; questmakerPrompt?: string }} RpgGraphQuest */
/** @typedef {{ from: string; to: string }} RpgGraphEdge */
/** @typedef {{ quests: RpgGraphQuest[]; edges: RpgGraphEdge[] }} RpgGraph */

/** Leerer Graph: Initialzustand bis Server-Bootstrap (kein Sample-Flash beim Laden). */
export const EMPTY_RPG_GRAPH = /** @type {RpgGraph} */ ({ quests: [], edges: [] });

/** @type {RpgGraph} */
export const SAMPLE_RPG_GRAPH = {
  quests: [
    {
      id: 'main-architect',
      parentId: null,
      title: 'Der rote Faden',
      description:
        'Du strukturierst dein Leben um ein langfristiges Ziel: weniger reagieren, mehr bauen. Jeder Schritt ist eine bewusste Entscheidung, nicht ein Zufallstreffer.',
      children: [
        { id: 'm1', parentId: 'main-architect', label: 'Klarheit: ein Satz, wofür die nächsten Jahre da sind', children: [] },
        { id: 'm2', parentId: 'main-architect', label: 'Umgebung so trimmen, dass sie das Ziel trägt, nicht sabotiert', children: [] },
        { id: 'm3', parentId: 'main-architect', label: 'Ein Ritual, das wöchentlich Fortschritt sichtbar macht', children: [] },
        { id: 'm4', parentId: 'main-architect', label: 'Nein sagen zu einer großen Ablenkung', children: [] },
      ],
      questRewards: [{ text: '+2 Klarheit' }, { text: 'Titel: Architekt' }, { text: 'Cutscene: Morgenlicht' }],
    },
    {
      id: 'main-bridge',
      parentId: null,
      title: 'Brücke bauen',
      description:
        'Zwischen dem, der du warst, und dem, der du werden willst, fehlt eine Brücke aus konkreten Taten.',
      children: [
        { id: 'b1', parentId: 'main-bridge', label: 'Eine ehrliche Bilanz: was bleibt, was fliegt', children: [] },
        { id: 'b2', parentId: 'main-bridge', label: 'Ein Gespräch, das du seit Monaten vermeidest', children: [] },
      ],
      questRewards: [{ type: 'item', itemId: 'sample-toolbox', displayName: 'Werkzeugkasten' }],
    },
    {
      id: 'side-read',
      parentId: null,
      title: 'Seiten statt Scrollen',
      description:
        'Nebenquest: wieder mehr Tiefe statt Dauerfeuer. Ein Buch, ein Stift, keine Ausreden.',
      children: [
        { id: 's1', parentId: 'side-read', label: '30 Minuten ohne zweiten Bildschirm', children: [] },
        { id: 's2', parentId: 'side-read', label: 'Ein Kapitel zu Ende lesen', children: [] },
        { id: 's3', parentId: 'side-read', label: 'Eine Notiz, die du in einer Woche noch verstehst', children: [] },
      ],
      questRewards: [{ text: '+XP Lesen' }, { text: 'Cosmetic: Lesezeichen' }],
    },
    {
      id: 'side-walk',
      parentId: null,
      title: 'Draußen-Level',
      description: 'Kurz raus, Kopf leeren, Körper mitnehmen.',
      children: [{ id: 'w1', parentId: 'side-walk', label: '20 Minuten ohne Podcast', children: [] }],
      questRewards: [{ text: 'Buff: Sonnenlicht' }],
    },
    {
      id: 'side-cook',
      parentId: null,
      title: 'Quest: Küche',
      description: 'Etwas kochen, das nicht aus „schnell und müde“ heißt.',
      children: [
        { id: 'c1', parentId: 'side-cook', label: 'Einkaufsliste ohne Impulskauf', children: [] },
        { id: 'c2', parentId: 'side-cook', label: 'Gericht zu Ende gebracht', children: [] },
      ],
      questRewards: [{ text: 'Recipe drop' }],
    },
  ],
  edges: [
    { from: 'side-read', to: 'main-architect' },
    { from: 'side-walk', to: 'main-architect' },
    { from: 'main-architect', to: 'main-bridge' },
    { from: 'side-cook', to: 'main-bridge' },
  ],
};

/**
 * Legacy-Shape: leere Listen; aktive Quests kommen nur aus localStorage + graph.
 * @type {RpgQuestPayloadLegacy}
 */
export const SAMPLE_RPG_QUESTS = {
  main: [],
  side: [],
};
