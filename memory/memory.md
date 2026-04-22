# Projekt-Memory (Einstieg)

Vor größeren Änderungen: **hier starten**, dann nur die **Unterdateien** öffnen, die zum Thema passen.

## Dokumentation (Pflicht, knapp)

- **Ort:** Sachverhalt unter `memory/` ablegen — bestehende `.mdc` erweitern oder **neue** Datei + **eine Zeile** in der Übersicht unten.
- **Inhalt:** Verhalten, **Pfade/Dateien**; API, Keys, Migration nur wenn betroffen — **kein** Code abschreiben.
- **Form:** Stichpunkte, möglichst **eine Zeile** pro Fakt; ausufernde Specs in eigene Datei auslagern und verlinken.

## Themenübersicht (vollständig, sortiert)

| Thema | Details |
|-------|---------|
| Astro Hybrid — Prerender (`[tag].astro`), Nav2/Cookies, Build `.vercel/output` | [`astro-prerender-hybrid.mdc`](astro-prerender-hybrid.mdc) |
| Blogpost-Editor (Recht, Nav-Icon, API, Scribble-Editor, User-Grid) | [`blogpost-editor.mdc`](blogpost-editor.mdc) |
| Datenbank (libsql / SQLite lokal, Turso prod, `db.js`) | [`database.mdc`](database.mdc) |
| fgraffiti (globales Overlay, Hotkey, Stift/Spray, Settings) | [`fgraffiti.mdc`](fgraffiti.mdc) |
| KI-Nutzung (DB-Log, Einstellungen-Tab) | [`database.mdc`](database.mdc) (`ai_usage_log`, `ai-usage-db.js`) |
| Math-Minigames (Fluss, Fraktale, Korrektheit, Pfade) | [`math-minigames.mdc`](math-minigames.mdc) |
| RPG Memory-System (zentraler Einstieg, nicht zeitbasiert) | [`rpg/index.mdc`](rpg/index.mdc) |
| Security — sensible APIs, Env, Risiken, Maßnahmen (**lokal:** `security-sensitive.md`, **gitignored**) | (Datei nur lokal anlegen; nicht committen) |
| Site — Theme-System (global, Light/Dark, Storage, Init) | [`site-theme-system.mdc`](site-theme-system.mdc) |
| Tester-Modus (Tester-Freigaben, Screenshot-Bugs, Feature-Toggles) | [`tester-features.mdc`](tester-features.mdc) |
| Topic-Feeds (RSS, Allowlist, KI-Plan/Summary, Home + Settings) | [`custom-topic-feeds.mdc`](custom-topic-feeds.mdc) |

Weitere Themen: bei Bedarf neue Dateien unter `memory/` anlegen und in dieser Übersicht verlinken.
