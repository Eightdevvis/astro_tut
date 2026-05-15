// Daten fuer das Minigame "Archaea: Membran: Lipide".
//
// Die drei Lipide aus Madigan/Brock Mikrobiologie, Kapitel Archaea-Membranen:
//   (a) Glycerindiether — Diphytanyl-Glycerol-Diether (Archaeol, mit Phosphat)
//   (b) Glycerintetraether — bipolarer Bisphosphat-Tetraether (Caldarchaeol-Typ),
//                            zwei Glycerole via zwei C40-Biphytanyl-Brücken,
//                            macrocyclisch geschlossen.
//   (c) Crenarchaeol — Tetraether ohne Phosphat (freie Hydroxyle), eine
//                      Biphytanyl-Kette mit Cyclopentan/Cyclohexan-Ringen.
//                      SMILES hier ohne Ringe als Baseline; richtige Struktur
//                      bei Bedarf hier hineinpatchen.
//
// SMILES dienen Level 2: beim Mount in Ketcher laden, InChI abgreifen, cachen.
// Vergleich gegen User-InChI = "richtig". Atomzaehlungen sind zusaetzlich fuer
// die Aehnlichkeits-Prozentleiste, wenn die Antwort nicht exakt stimmt.
//
// Bilder (PNG) liegen unter public/images/. Wenn ein Bild fehlt, faellt die
// UI auf einen Platzhalter zurueck (Box mit "Bild fehlt: <pfad>").

export const ARCHAEA_LIPIDS = [
  {
    id: 'glycerindiether',
    letter: 'a',
    name: 'Glycerindiether',
    image: '/images/archaea-lipid-a.png',
    smiles: 'OP(=O)(O)OCC(OCCC(C)CCCC(C)CCCC(C)CCCC(C)C)COCCC(C)CCCC(C)CCCC(C)CCCC(C)C',
    atoms: { C: 43, O: 6, P: 1 },
    hint: 'Glycerol-Diether mit zwei Phytanyl-Ketten und Phosphat-Kopf.',
  },
  {
    id: 'glycerintetraether',
    letter: 'b',
    name: 'Glycerintetraether',
    image: '/images/archaea-lipid-b.png',
    smiles:
      'OP(=O)(O)OCC(OCCC(C)CCCC(C)CCCC(C)CCCC(C)CCC(C)CCCC(C)CCCC(C)CCCC(C)CCO1)COCCC(C)CCCC(C)CCCC(C)CCCC(C)CCC(C)CCCC(C)CCCC(C)CCCC(C)CCOCC1COP(=O)(O)O',
    atoms: { C: 86, O: 12, P: 2 },
    hint: 'Bipolarer Tetraether, zwei Glycerole via zwei C40-Biphytanyl-Bruecken (macrocyclisch).',
  },
  {
    id: 'crenarchaeol',
    letter: 'c',
    name: 'Crenarchaeol',
    image: '/images/archaea-lipid-c.png',
    smiles:
      'OCC(OCCC(C)CCCC(C)CCCC(C)CCCC(C)CCC(C)CCCC(C)CCCC(C)CCCC(C)CCO1)COCCC(C)CCCC(C)CCCC(C)CCCC(C)CCC(C)CCCC(C)CCCC(C)CCCC(C)CCOCC1CO',
    atoms: { C: 86, O: 6, P: 0 },
    hint: 'Tetraether ohne Phosphat, freie Hydroxyle. SMILES-Baseline ohne Ringe.',
  },
];

export function lipidById(id) {
  return ARCHAEA_LIPIDS.find((l) => l.id === id) || null;
}

// Lockerer String-Match fuer Level 1: Groß-/Kleinschreibung egal, Whitespace
// trimmen, Umlaute toleranter. Streng genug, dass "Glyc" allein nicht reicht.
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
