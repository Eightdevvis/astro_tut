# Projekt-Anweisungen — astro-tut

## RPG-Memory-Pflege (Pflicht)

Bei allen Änderungen im Projekt muss die Memory mitgepflegt werden:

- **Auto-Memory** (immer geladen): `~/.claude/projects/-home-sasha-codicus-astrotutut-astro-tut/memory/MEMORY.md`
- **Repo-Memory** (bei Bedarf): `memory/rpg/*.mdc` — Einstieg `memory/rpg/index.mdc`, Zuordnung Bereich→Datei `memory/rpg/source-map.mdc`

Bugfixes brauchen kein Memory-Update.

## UX-Naming-Regel

Code-Variablen bleiben kanonisch `node`/`Node`. Sichtbare UI-Texte sagen ausschliesslich „Quest" (Topbar, Buttons, aria-labels, Tooltips, Builder-Felder). Begruendung in `memory/rpg/ui.mdc`.

## Tests

`node --test tests/` (NPM-Skript hat ein Glob-Problem mit `tests/*.test.js` — das wird vom Shell nicht expandiert; lieber direkt aufrufen). Stand 2026-05-04 (nach Sibling-Lock-Integration in computeLockedNodeIds): **421/0**.

## Build-Hinweis

Astro verlangt Node >=18.20.8. `node --test` ist unabhaengig vom Astro-Build.
