// Sample quest data — modeled on the real RpgQuestTree shape (children-tree, leaves, locks).
// All states represented: locked, unlocked-not-added, active, done.

const QUESTS = [
  {
    id: 'digital-home-zentrale',
    title: 'digital home ZENTRALE',
    questmaker: 'Bauen, dass der Raum mitdenkt — Wand, Tutor, Augen.',
    cityLocation: 'Berlin · Mitte',
    status: 'active', // active | locked | done
    rewards: [
      { kind: 'item', label: 'Wandhalterung', icon: '◧' },
      { kind: 'mana', label: '+12', icon: '◐' },
    ],
    rootCount: 3,
    leafCount: 3,
    questRewardsCount: 0,
    cityLock: '—',
    activeNode: 'Quest-Root',
    progress: 0.34,
    children: [
      {
        id: 'building-zentrale',
        title: 'building the basic ZENTRALE',
        desc: 'Stromleiste, Halterung, erste boot-fähige Maschine an der Wand.',
        state: 'active',
        progress: 0.55,
        urgent: false,
        children: [
          { id: 'b-power', title: 'Stromleiste verlegen', state: 'done' },
          { id: 'b-mount', title: 'Halterung montieren', state: 'done' },
          { id: 'b-boot', title: 'Erstes Boot', state: 'active' },
        ],
      },
      {
        id: 'ai-tutor-wall',
        title: 'ai tutor on your wall',
        desc: 'Tutor-Persona, Mic-Input, immer-an Display.',
        state: 'unlocked-not-added',
        progress: 0,
        urgent: true,
        dueIn: 4,
        children: [
          { id: 't-persona', title: 'Persona schreiben', state: 'idle' },
          { id: 't-mic', title: 'Mic + push-to-talk', state: 'idle' },
        ],
      },
      {
        id: 'give-eyes',
        title: 'give it eyes',
        desc: 'Kamera + Vision-Loop, damit der Raum gesehen wird.',
        state: 'locked',
        progress: 0,
        children: [
          { id: 'e-cam', title: 'Kamera platzieren', state: 'locked' },
          { id: 'e-vision', title: 'Vision-Loop', state: 'locked' },
        ],
      },
    ],
  },
  {
    id: 'ballett',
    title: 'Ballett',
    questmaker: 'Tägliche Praxis — Körper als Werkzeug.',
    cityLocation: 'Studio Süd',
    status: 'unlocked-not-added',
    rewards: [{ kind: 'heart', label: '+8', icon: '♥' }],
    rootCount: 1,
    leafCount: 0,
    children: [],
  },
  {
    id: 'wochenmarkt-ritual',
    title: 'Wochenmarkt-Ritual',
    questmaker: 'Samstags früh, Marktmühle, Vorräte.',
    cityLocation: 'Boxhagener Platz',
    status: 'done',
    rewards: [
      { kind: 'item', label: 'Vorratsregal', icon: '▦' },
      { kind: 'mana', label: '+4', icon: '◐' },
    ],
    rootCount: 1,
    leafCount: 2,
    children: [
      {
        id: 'wm-route',
        title: 'Standard-Route',
        state: 'done',
        children: [
          { id: 'wm-a', title: 'Käse-Stand', state: 'done' },
          { id: 'wm-b', title: 'Brot-Stand', state: 'done' },
        ],
      },
    ],
  },
  {
    id: 'briefe-archiv',
    title: 'Briefe-Archiv',
    questmaker: 'Briefkasten, Scanner, Tagging-Loop.',
    cityLocation: '—',
    status: 'active',
    rewards: [{ kind: 'mana', label: '+6', icon: '◐' }],
    rootCount: 2,
    leafCount: 4,
    progress: 0.5,
    children: [
      {
        id: 'br-scan',
        title: 'Scanner-Setup',
        state: 'done',
        children: [
          { id: 'br-1', title: 'ScanSnap einrichten', state: 'done' },
          { id: 'br-2', title: 'OCR-Pipeline', state: 'done' },
        ],
      },
      {
        id: 'br-tag',
        title: 'Tagging',
        state: 'active',
        urgent: false,
        children: [
          { id: 'br-3', title: 'Auto-Tag', state: 'active' },
          { id: 'br-4', title: 'Manuelle Korrektur', state: 'idle' },
        ],
      },
    ],
  },
  {
    id: 'kueche-2-0',
    title: 'Küche 2.0',
    questmaker: 'Mise en place, Inventur, Werkzeug.',
    cityLocation: 'Berlin · Wohnung',
    status: 'locked',
    cityLock: '🔒 Werkstatt-Zugang',
    rewards: [{ kind: 'item', label: 'Schubladen-System', icon: '▥' }],
    rootCount: 2,
    leafCount: 5,
    children: [],
  },
];

const VITALS = {
  heart: { value: 14, max: 20 },
  mana: { value: 8, max: 12 },
};

const LOCATION = {
  city: 'Berlin',
  district: 'Friedrichshain',
  place: 'Schreibtisch · Nordfenster',
};

window.__QUEST_DATA = { QUESTS, VITALS, LOCATION };
