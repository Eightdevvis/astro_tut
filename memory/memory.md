# Projekt-Memory (Einstieg)

Vor größeren Änderungen: **hier starten**, dann nur die **Unterdateien** öffnen, die zum Thema passen.

## Dokumentation (Pflicht, knapp)

- **Ort:** Sachverhalt unter `memory/` ablegen — bestehende `.mdc` erweitern oder **neue** Datei + **eine Zeile** in der Tabelle unten.
- **Inhalt:** Verhalten, **Pfade/Dateien**; API, Keys, Migration nur wenn betroffen — **kein** Code abschreiben.
- **Form:** Stichpunkte, möglichst **eine Zeile** pro Fakt; ausufernde Specs in eigene Datei auslagern und verlinken.

| Thema | Details |
|--------|---------|
| Datenbank (libsql / SQLite lokal, Turso prod, `db.js`) | [`database.mdc`](database.mdc) |
| Math-Minigames (Fluss, Fraktale, Korrektheit, Pfade) | [`math-minigames.mdc`](math-minigames.mdc) |
| RPG Quest-Hub (Main/Side, Fokus, Graph) | [`rpg-quests.mdc`](rpg-quests.mdc) |
| RPG — strukturierte Steps, Fristen, Rewards (Spez + Code-Pfade) | [`rpg-quests-steps-rewards.mdc`](rpg-quests-steps-rewards.mdc) |
| RPG — Questmaker+, API, Rückfragen, Env | [`rpg-quests-ai.mdc`](rpg-quests-ai.mdc) |
| KI-Nutzung (DB-Log, Einstellungen-Tab) | [`database.mdc`](database.mdc) (`ai_usage_log`, `ai-usage-db.js`) |
| Tester-Modus (Tester-Freigaben, Screenshot-Bugs, Feature-Toggles) | [`tester-features.mdc`](tester-features.mdc) |
| RPG — kommende Features (Backup, …) | [`rpg-quests-upcoming.mdc`](rpg-quests-upcoming.mdc) |
| RPG — vielleicht kommend (Default-Graph, …) | [`rpg-quests-maybe.mdc`](rpg-quests-maybe.mdc) |
| Astro Hybrid — Prerender (`[tag].astro`), Nav2/Cookies, Build `.vercel/output` | [`astro-prerender-hybrid.mdc`](astro-prerender-hybrid.mdc) |
| Security — sensible APIs, Env, Risiken, Maßnahmen (**lokal:** `security-sensitive.md`, **gitignored**) | (Datei nur lokal anlegen; nicht committen) |

Weitere Themen: bei Bedarf neue Dateien unter `memory/` anlegen und in dieser Tabelle verlinken.
