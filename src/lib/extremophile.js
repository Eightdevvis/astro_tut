// Daten fuer das Minigame "Extremophile".
//
// Quelle: Lehrbuch-Tabelle (Madigan/Brock o.ae.) mit fuenf Parameter-
// Klassen extrem-anpassungsfaehiger Mikroorganismen. Aktuell pro Kategorie
// genau eine Beispielart — bei Bedarf hier ergaenzen, der Quiz-Flow ist
// auf "Nenne EINE Art" ausgelegt (akzeptiert kuenftig ein Array von
// `species`).

export const CATEGORIES = [
  {
    id: 'hyperthermophile',
    title: 'Hyperthermophile',
    parameter: 'Temperatur',
    direction: 'hoch',
    iconKey: 'flame',
    species: {
      name: 'Methanopyrus kandleri',
      domain: 'Archaea',
      habitat: 'Heisse Kamine unter dem Meeresspiegel',
      habitatAlts: ['schwarze raucher', 'hydrothermalquellen', 'hydrothermalschlote', 'tiefseequellen', 'kamine'],
      min: { value: 90, display: '90 °C' },
      optimum: { value: 106, display: '106 °C' },
      max: { value: 122, display: '122 °C' },
    },
  },
  {
    id: 'psychrophile',
    title: 'Psychrophile',
    parameter: 'Temperatur',
    direction: 'niedrig',
    iconKey: 'snowflake',
    species: {
      name: 'Psychromonas ingrahami',
      domain: 'Bacteria',
      habitat: 'Eismeer',
      habitatAlts: ['polareis', 'meereis', 'arktis', 'antarktis'],
      min: { value: -12, display: '−12 °C' },
      optimum: { value: 5, display: '5 °C' },
      max: { value: 10, display: '10 °C' },
    },
  },
  {
    id: 'acidophile',
    title: 'Acidophile',
    parameter: 'pH',
    direction: 'niedrig',
    iconKey: 'acid',
    species: {
      name: 'Picrophilus oshimae',
      domain: 'Archaea',
      habitat: 'Saeurehaltige heisse Quellen',
      habitatAlts: ['solfataren', 'saure quellen', 'vulkanquellen', 'thermalquellen', 'fumarolen'],
      min: { value: -0.06, display: '−0,06' },
      optimum: { value: 0.7, display: '0,7' },
      max: { value: 4, display: '4' },
    },
  },
  {
    id: 'alkaliphile',
    title: 'Alkaliphile',
    parameter: 'pH',
    direction: 'hoch',
    iconKey: 'alkali',
    species: {
      name: 'Natronobacterium gregoryi',
      domain: 'Archaea',
      habitat: 'Sodaseen',
      habitatAlts: ['sodaseen', 'soda', 'salzseen alkalisch', 'natronseen'],
      min: { value: 8.5, display: '8,5' },
      optimum: { value: 10, display: '10' },
      max: { value: 12, display: '12' },
    },
  },
  {
    id: 'barophile',
    title: 'Barophile',
    parameter: 'Druck',
    direction: 'hoch',
    iconKey: 'pressure',
    species: {
      name: 'Moritella yayanosii',
      domain: 'Bacteria',
      habitat: 'Tiefseesedimente',
      habitatAlts: ['tiefsee', 'tiefseeboden', 'sediment', 'meeresboden tief'],
      min: { value: 500, display: '500 atm' },
      optimum: { value: 700, display: '700 atm' },
      max: { value: 1000, display: '>1000 atm' },
    },
  },
  {
    id: 'halophile',
    title: 'Halophile',
    parameter: 'Salz (NaCl)',
    direction: 'hoch',
    iconKey: 'salt',
    species: {
      name: 'Halobacterium salinarum',
      domain: 'Archaea',
      habitat: 'Salinen',
      habitatAlts: ['salzsee', 'totes meer', 'salzgewaesser', 'salzteiche'],
      min: { value: 15, display: '15 %' },
      optimum: { value: 25, display: '25 %' },
      max: { value: 32, display: '32 % (Saettigung)' },
    },
  },
];

export const QUESTIONS = [
  { id: 'species', prompt: 'Nenne eine Art.', kind: 'name', field: 'name' },
  { id: 'domain', prompt: 'Zu welcher Gruppe gehoert sie?', kind: 'domain', field: 'domain' },
  { id: 'habitat', prompt: 'Wo lebt sie typischerweise?', kind: 'habitat', field: 'habitat' },
  { id: 'optimum', prompt: 'Was ist ihr Optimum?', kind: 'numeric', field: 'optimum' },
  { id: 'min', prompt: 'Was ist das Minimum?', kind: 'numeric', field: 'min' },
  { id: 'max', prompt: 'Was ist das Maximum?', kind: 'numeric', field: 'max' },
];

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function checkAnswer(category, question, userInput) {
  const norm = normalize(userInput);
  if (!norm) return false;
  const species = category.species;
  switch (question.kind) {
    case 'name':
      return norm === normalize(species.name);
    case 'domain':
      return norm === normalize(species.domain);
    case 'habitat': {
      const target = normalize(species.habitat);
      if (norm === target) return true;
      const alts = (species.habitatAlts || []).map(normalize);
      for (const alt of alts) {
        if (norm === alt) return true;
        if (alt && (norm.includes(alt) || alt.includes(norm))) return true;
      }
      // Wortueberschneidung als locker Akzeptanzkriterium.
      const userTokens = tokens(norm);
      const targetTokens = tokens(target);
      for (const u of userTokens) {
        for (const t of targetTokens) {
          if (u === t || (t.length > 3 && u.includes(t)) || (u.length > 3 && t.includes(u))) {
            return true;
          }
        }
      }
      return false;
    }
    case 'numeric': {
      const val = species[question.field];
      if (!val) return false;
      const userNum = extractNumber(userInput);
      if (userNum === null) return false;
      return Math.abs(userNum - val.value) < 0.001;
    }
    default:
      return false;
  }
}

export function totalPossibleCorrect() {
  return CATEGORIES.length * QUESTIONS.length;
}

function normalize(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.,;:!?]/g, '')
    .replace(/\s+/g, ' ');
}

function tokens(s) {
  return normalize(s).split(' ').filter((t) => t.length > 0);
}

function extractNumber(s) {
  // Akzeptiert deutsche Notation ("0,7"), Vorzeichen, Dezimalpunkte, "−" (U+2212).
  const cleaned = String(s || '').replace(/−/g, '-').replace(/,/g, '.');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  return parseFloat(m[0]);
}
