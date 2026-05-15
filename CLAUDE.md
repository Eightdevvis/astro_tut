# Projekt-Anweisungen — astro-tut

## Memory-Pflege (Pflicht, pedantisch)

Wir haben ein **striktes** Memory-System. Bei **jeder** inhaltlichen Änderung am Projekt — Feature, Refactor, Architektur-Umbau, Pfad-/Namens-/API-Änderung, neue Permissions, neue Seiten/Komponenten, geänderte Verhalten — muss die Memory mitgepflegt werden. Es gibt **keine** Ausnahme für "kleine" Änderungen. Einzige Ausnahme: reine Bugfixes ohne Verhaltensänderung.

### Quellen (beide pflegen, falls erreichbar)

- **Repo-Memory** (immer pflegen, wird mit-committet): das **gesamte** `memory/`-Verzeichnis im Repo. **Einstieg: `memory/memory.md`** — Themenübersicht mit Verlinkung. Unterdateien:
  - `memory/*.mdc` — Top-Level-Themen (z. B. `math-minigames.mdc`, `mikrobiologie.mdc`, `blogpost-editor.mdc`, `database.mdc` …).
  - `memory/rpg/*.mdc` — Sub-Bereich nur fuer das RPG/Quest-System. Einstieg `memory/rpg/index.mdc`, Bereichszuordnung `memory/rpg/source-map.mdc`.
  - Achtung: `rpg/` ist **nicht** der gesamte Repo-Memory, sondern nur ein Unterordner. Neue Themen ausserhalb von RPG kommen als eigene `.mdc` direkt unter `memory/` an.
- **Auto-Memory** (user-lokal, ausserhalb des Repos): `~/.claude/projects/-home-sasha-codicus-astrotutut-astro-tut/memory/MEMORY.md`. Wird bei jeder Session automatisch geladen. **Aus Web/Remote-Sessions oft nicht erreichbar** (der Pfad ist sasha-lokal). Wenn nicht erreichbar: nur Repo-Memory pflegen und am Ende kurz erwaehnen, dass Auto-Memory ggf. lokal nachgezogen werden muss.

### Ablauf pro Änderung

1. **Vor** der Aenderung `memory/memory.md` (Themenuebersicht) ueberfliegen und das passende Thema identifizieren — RPG-Aenderungen zusaetzlich gegen `memory/rpg/source-map.mdc` pruefen.
2. **Nach** der Aenderung:
   - Passende `.mdc` **erweitern** (Stichpunkte, moeglichst eine Zeile pro Fakt; Pfade/Dateien benennen; keinen Code abschreiben).
   - Wenn das Thema noch nicht existiert: **neue** `.mdc` anlegen + **eine Zeile** in der Tabelle von `memory/memory.md` ergaenzen.
   - Veraltete Fakten in der gleichen Datei **streichen oder korrigieren**, nicht danebenschreiben.
3. **Memory-Update im selben PR/Commit** wie die Code-Aenderung — nicht "spaeter nachziehen". Wenn aus Versehen ohne Memory committet wurde, sofort einen Folge-Commit `docs(memory): …` hinterherschieben (siehe `0bebf13` als Beispiel: holt nach, was bei `99e54a8` liegen blieb).

### Stilregeln (aus `memory/memory.md`)

- **Form:** Stichpunkte, eine Zeile pro Fakt; ausufernde Specs in eigene Datei + Link.
- **Inhalt:** Verhalten, Pfade/Dateien; APIs/Keys/Migration nur wenn betroffen; **kein** Code copy-paste.
- **Ort:** ein Thema = eine `.mdc`; bei Bedarf neue Datei + Index-Zeile, nicht in fremde Dateien quetschen.

## UX-Naming-Regel

Code-Variablen bleiben kanonisch `node`/`Node`. Sichtbare UI-Texte sagen ausschliesslich „Quest" (Topbar, Buttons, aria-labels, Tooltips, Builder-Felder). Begruendung in `memory/rpg/ui.mdc`.

## Tests

`node --test tests/` (NPM-Skript hat ein Glob-Problem mit `tests/*.test.js` — das wird vom Shell nicht expandiert; lieber direkt aufrufen). Stand 2026-05-04 (nach Sibling-Lock-Integration in computeLockedNodeIds): **421/0**.

## Build-Hinweis

Astro verlangt Node >=18.20.8. `node --test` ist unabhaengig vom Astro-Build.

## Deploy / Push-Regel

**Direkt auf `master` pushen.** Vercel deployt nur `master` auf die echte Domain — Feature-Branches helfen Sasha nicht, weil sie nicht in Produktion landen. Also nach Commit:

1. Auf den vom Harness vorgegebenen Branch committen + pushen (Audit-Trail).
2. **Danach** den Commit auf `master` pushen (`git push origin HEAD:master`), damit Vercel deployt.
3. Keine Pull Requests aufmachen, keine Reviews abwarten — Sasha will, dass Änderungen sofort in Produktion landen.

Ausnahme: explizite Anweisung "nicht auf master" in der jeweiligen Session.
