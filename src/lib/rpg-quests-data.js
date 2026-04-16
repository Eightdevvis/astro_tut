/**
 * Default-/Sample-Quests und Kanon-Form für GET /api/rpg/quests.
 * Später: gleiche Struktur von KI oder DB liefern lassen.
 */

/** @typedef {import('./rpg-quest-steps.js').RpgQuestStepNode} RpgQuestStep */
/** @typedef {import('./rpg-quest-steps.js').RpgQuestRewardEntry} RpgQuestRewardEntry */
/** @typedef {{ id: string; title: string; description: string; steps: RpgQuestStep[]; rewards?: string[] }} RpgQuest */
/** @typedef {{ main: RpgQuest[]; side: RpgQuest[] }} RpgQuestPayloadLegacy */
/** @typedef {{ id: string; kind: 'main' | 'side'; title: string; description: string; cityLocation?: string; steps: RpgQuestStep[]; rewards?: string[]; questRewards?: RpgQuestRewardEntry[]; questmakerPrompt?: string }} RpgGraphQuest */
/** @typedef {{ from: string; to: string }} RpgGraphEdge */
/** @typedef {{ quests: RpgGraphQuest[]; edges: RpgGraphEdge[] }} RpgGraph */

/** Leerer Graph: Initialzustand bis Server-Bootstrap (kein Sample-Flash beim Laden). */
export const EMPTY_RPG_GRAPH = /** @type {RpgGraph} */ ({ quests: [], edges: [] });

/** @type {RpgGraph} */
export const SAMPLE_RPG_GRAPH = {
  quests: [
    {
      id: 'main-architect',
      kind: 'main',
      title: 'Der rote Faden',
      description:
        'Du strukturierst dein Leben um ein langfristiges Ziel: weniger reagieren, mehr bauen. Jeder Schritt ist eine bewusste Entscheidung, nicht ein Zufallstreffer.',
      steps: [
        { id: 'm1', label: 'Klarheit: ein Satz, wofür die nächsten Jahre da sind' },
        { id: 'm2', label: 'Umgebung so trimmen, dass sie das Ziel trägt, nicht sabotiert' },
        { id: 'm3', label: 'Ein Ritual, das wöchentlich Fortschritt sichtbar macht' },
        { id: 'm4', label: 'Nein sagen zu einer großen Ablenkung' },
      ],
      questRewards: [{ text: '+2 Klarheit' }, { text: 'Titel: Architekt' }, { text: 'Cutscene: Morgenlicht' }],
    },
    {
      id: 'main-bridge',
      kind: 'main',
      title: 'Brücke bauen',
      description:
        'Zwischen dem, der du warst, und dem, der du werden willst, fehlt eine Brücke aus konkreten Taten.',
      steps: [
        { id: 'b1', label: 'Eine ehrliche Bilanz: was bleibt, was fliegt' },
        { id: 'b2', label: 'Ein Gespräch, das du seit Monaten vermeidest' },
      ],
      questRewards: [{ type: 'item', itemId: 'sample-toolbox', displayName: 'Werkzeugkasten' }],
    },
    {
      id: 'side-read',
      kind: 'side',
      title: 'Seiten statt Scrollen',
      description:
        'Nebenquest: wieder mehr Tiefe statt Dauerfeuer. Ein Buch, ein Stift, keine Ausreden.',
      steps: [
        { id: 's1', label: '30 Minuten ohne zweiten Bildschirm' },
        { id: 's2', label: 'Ein Kapitel zu Ende lesen' },
        { id: 's3', label: 'Eine Notiz, die du in einer Woche noch verstehst' },
      ],
      questRewards: [{ text: '+XP Lesen' }, { text: 'Cosmetic: Lesezeichen' }],
    },
    {
      id: 'side-walk',
      kind: 'side',
      title: 'Draußen-Level',
      description: 'Kurz raus, Kopf leeren, Körper mitnehmen.',
      steps: [{ id: 'w1', label: '20 Minuten ohne Podcast' }],
      questRewards: [{ text: 'Buff: Sonnenlicht' }],
    },
    {
      id: 'side-cook',
      kind: 'side',
      title: 'Quest: Küche',
      description: 'Etwas kochen, das nicht aus „schnell und müde“ heißt.',
      steps: [
        { id: 'c1', label: 'Einkaufsliste ohne Impulskauf' },
        { id: 'c2', label: 'Gericht zu Ende gebracht' },
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
