# /public/lipids/

Statische SVG-Bilder für das Archaea-Lipide-Minigame (`/minigames/mikrobiologie/archaea-membran-lipide`).

## Konvention

Pro Lipid eine SVG-Datei, benannt nach der `id` aus `src/lib/archaea-lipids.js`:

| Datei | Lipid |
|-------|-------|
| `glycerindiether.svg` | Archaeol + Phosphat |
| `glycerintetraether.svg` | Caldarchaeol (Bisphosphat, macrocyclisch) |
| `crenarchaeol.svg` | Crenarchaeol (Tetraether, gemischte Ringe) |

## Wie der Game das lädt

`lipidImageUrl(lipid)` in `src/components/ArchaeaLipidsGame.jsx` schaut **zuerst** ob `/lipids/<id>.svg` existiert (per `<img onError>`-Fallback). Wenn ja, wird das genommen; wenn nicht, fällt's auf eine Simolecule-CDK-Depict-URL zurück. So kannst du SVGs Stück für Stück nachziehen ohne Code-Änderung.

## Stil

Lehrbuch-Konvention für Membran-Bilayer-Diagramme: Biphytanyl-Ketten **gefaltet** quer über die Membran statt ausgestreckt; Kopfgruppen (Phosphat / OH) oben/unten; Ringe (Cyclopentane/Cyclohexan) in der Mitte der Kette eingebettet darstellen. CDK Depict / Auto-Renderer können das nicht — daher handmade.
