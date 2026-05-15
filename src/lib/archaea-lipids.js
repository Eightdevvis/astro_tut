// Daten fuer das Minigame "Archaea: Membran: Lipide".
//
// Die drei Lipide aus Madigan/Brock Mikrobiologie, Kapitel Archaea-Membranen:
//   (a) Glycerindiether — Diphytanyl-Glycerol-Diether (Archaeol, mit Phosphat).
//   (b) Glycerintetraether — bipolarer Bisphosphat-Tetraether (Caldarchaeol-Typ),
//                            zwei Glycerole via zwei C40-Biphytanyl-Bruecken,
//                            macrocyclisch geschlossen.
//   (c) Crenarchaeol — Tetraether ohne Phosphat (freie Hydroxyle), Biphytanyl-
//                      Ketten mit 1 Cyclopentan oben + 3 Cyclopentanen + 1
//                      Cyclohexan unten. Plausible Platzierung; exakte
//                      Ringpositionen nicht relevant fuer die Lehre (Prinzip:
//                      "Archaea-Lipid mit Ringen -> Membranfluiditaets-
//                      Anpassung"). Referenz fuer die offizielle Struktur:
//                      Sinninghe Damste et al. (2002), Org. Geochem.
//
// SMILES dienen zwei Zwecken:
//   1. Level 1: Ketcher rendert die SMILES als read-only-Bild als Prompt.
//   2. Level 2: Beim Pruefen vergleichen wir User-Struktur gegen Target-SMILES.
//      Score per gewichteter Atomzaehlung (siehe ArchaeaLipidsGame.jsx).
//
// Hinweis zur Ringinsertion (c): chemisch entstehen Crenarchaeol-Ringe durch
// intramolekulare Cyclisierung bestehender Methyl-Verzweigungen — meine SMILES
// fuegt die Ring-Atome dagegen zusaetzlich ein (3 C pro 5-Ring, 4 C pro 6-Ring).
// Die Molekuelformel weicht damit von C86H162O6 in der Literatur ab. Akzeptiert
// fuer Lehrzweck; bei Bedarf hier hineinpatchen.

const PHYTANYL = 'CCC(C)CCCC(C)CCCC(C)CCCC(C)C';
const BIPHYTANYL =
  'CCC(C)CCCC(C)CCCC(C)CCCC(C)CCC(C)CCCC(C)CCCC(C)CCCC(C)CC';
const BIPHYTANYL_1_CYP =
  'CCC(C)CCCC(C)CCCC(C)CC2CCCC2C(C)CCC(C)CCCC(C)CCCC(C)CCCC(C)CC';
const BIPHYTANYL_3_CYP_1_CYH =
  'CCC(C)CC3CCCC3C(C)CCC4CCCC4C(C)CC5CCCCC5C(C)CCC(C)CCCC(C)CC6CCCC6C(C)CCCC(C)CC';

// Mini-SMILES-Parser für Atomzählungen (ohne H). Reicht für unser Alphabet:
// C, O, P (alle einbuchstabig, keine aromatische Notation, keine Cl/Br).
// Brackets `[...]` werden behandelt; Zahlen/Bindungen/Klammern/Schrägstriche
// übersprungen. Vorher lief das über `ketcher.setMolecule()` + `getMolfile()`
// pro Lipid — Indigo brauchte für macrocyclische Lipide Minuten und blockte
// das gesamte Vorrendern.
export function atomCountsFromSmiles(smiles) {
  const counts = {};
  const s = String(smiles || '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) break;
      const inner = s.slice(i + 1, end);
      const m = inner.match(/^\d*([A-Z][a-z]?)/);
      if (m && m[1] !== 'H') counts[m[1]] = (counts[m[1]] || 0) + 1;
      i = end + 1;
      continue;
    }
    if (c >= 'A' && c <= 'Z') {
      const next = s[i + 1];
      const isTwoLetter =
        (c === 'C' && next === 'l') || (c === 'B' && next === 'r');
      const elem = isTwoLetter ? c + next : c;
      if (elem !== 'H') counts[elem] = (counts[elem] || 0) + 1;
      i += isTwoLetter ? 2 : 1;
      continue;
    }
    // Aromatische Kleinbuchstaben (kommen in unseren Lipiden nicht vor, aber
    // billig zu unterstützen).
    if (c === 'c' || c === 'n' || c === 'o' || c === 's' || c === 'p') {
      const elem = c.toUpperCase();
      counts[elem] = (counts[elem] || 0) + 1;
    }
    i += 1;
  }
  return counts;
}

export const ARCHAEA_LIPIDS = [
  {
    id: 'glycerindiether',
    letter: 'a',
    name: 'Glycerindiether',
    smiles: `OP(=O)(O)OCC(O${PHYTANYL})CO${PHYTANYL}`,
    hint: 'Glycerol-Diether mit zwei Phytanyl-Ketten und Phosphat-Kopf.',
  },
  {
    id: 'glycerintetraether',
    letter: 'b',
    name: 'Glycerintetraether',
    smiles: `OP(=O)(O)OCC(O${BIPHYTANYL}O1)CO${BIPHYTANYL}OCC1COP(=O)(O)O`,
    hint: 'Bipolarer Tetraether, zwei Glycerole via zwei C40-Biphytanyl-Bruecken (macrocyclisch).',
  },
  {
    id: 'crenarchaeol',
    letter: 'c',
    name: 'Crenarchaeol',
    smiles: `OCC(O${BIPHYTANYL_1_CYP}O1)CO${BIPHYTANYL_3_CYP_1_CYH}OCC1CO`,
    hint: 'Tetraether ohne Phosphat, freie Hydroxyle. Obere Kette mit 1 Cyclopentan, untere mit 3 Cyclopentanen + 1 Cyclohexan.',
  },
];

// Vorgerechnete Target-Atomzählungen — wird vom Game als Vergleichsbasis für
// L2-Score genutzt. Statisch ableitbar aus den SMILES, kein Ketcher nötig.
export const LIPID_TARGET_ATOMS = Object.fromEntries(
  ARCHAEA_LIPIDS.map((l) => [l.id, atomCountsFromSmiles(l.smiles)]),
);

export function lipidById(id) {
  return ARCHAEA_LIPIDS.find((l) => l.id === id) || null;
}

// Lockerer String-Match fuer Level 1: Groß-/Kleinschreibung egal, Umlaute
// ascii-fizieren, Whitespace trimmen. Streng genug, dass "Glyc" nicht reicht.
export function normalizeLipidName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ');
}

export function isNameCorrect(input, lipid) {
  return normalizeLipidName(input) === normalizeLipidName(lipid.name);
}
