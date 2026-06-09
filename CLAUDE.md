# Projekt-Anweisungen — astro-tut

## RPG-Memory-Pflege (Pflicht)

Bei allen Änderungen im Projekt muss die Memory mitgepflegt werden:

- **Auto-Memory** (immer geladen): `~/.claude/projects/-home-sasha-codicus-astrotutut-astro-tut/memory/MEMORY.md` ODER HIER: `~/.claude/projects/-home-sasha-codicus-blog/memory/MEMORY.md` (Laptop)
- **Repo-Memory** (bei Bedarf): `memory/rpg/*.mdc` — Einstieg `memory/rpg/index.mdc`, Zuordnung Bereich→Datei `memory/rpg/source-map.mdc`

Bugfixes brauchen kein Memory-Update.

## UX-Naming-Regel

Code-Variablen bleiben kanonisch `node`/`Node`. Sichtbare UI-Texte sagen ausschliesslich „Quest" (Topbar, Buttons, aria-labels, Tooltips, Builder-Felder). Begruendung in `memory/rpg/ui.mdc`.

## Tests

`npm run test:quality` (alias `node --test tests/`). Stand 2026-04-30: 338/0.

## Build-Hinweis

Astro verlangt Node >=18.20.8. `node --test` ist unabhaengig vom Astro-Build.
