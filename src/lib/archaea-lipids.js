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
