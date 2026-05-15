# /public/lipids/

Statische SVG-Bilder fuer das Archaea-Lipide-Minigame (`/minigames/mikrobiologie/archaea-membran-lipide`).

## Konvention

Pro Lipid eine SVG-Datei, benannt nach der `id` aus `src/lib/archaea-lipids.js`:

| Datei | Lipid |
|-------|-------|
| `glycerindiether.svg` | Archaeol + Phosphat |
| `glycerintetraether.svg` | Caldarchaeol (Bisphosphat, macrocyclisch) |
| `crenarchaeol.svg` | Crenarchaeol (Tetraether, gemischte Ringe) |

## Wie der Game das laedt

`lipidImageUrl(lipid)` in `src/components/ArchaeaLipidsGame.jsx` schaut **zuerst** ob `/lipids/<id>.svg` existiert (per `<img onError>`-Fallback). Wenn ja, wird das genommen; wenn nicht, faellt's auf eine Simolecule-CDK-Depict-URL zurueck. So kannst du SVGs Stueck fuer Stueck nachziehen ohne Code-Aenderung.

## Stil

Lehrbuch-Konvention fuer Membran-Bilayer-Diagramme: Biphytanyl-Ketten **gefaltet** quer ueber die Membran statt ausgestreckt; Kopfgruppen (Phosphat / OH) oben/unten; Ringe (Cyclopentane/Cyclohexan) in der Mitte der Kette eingebettet darstellen. CDK Depict / Auto-Renderer koennen das nicht — daher handmade.
