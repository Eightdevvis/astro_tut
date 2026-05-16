# Plan: Backup-Tresor + Privacy-Werkzeugkasten fuer Blogposts

Stand: 2026-05-16. Erstellt im Vorfeld der Umsetzung — noch nichts implementiert.
Branch der Umsetzung: `claude/backup-privacy-update-G1UAA`.

## 0. Ziel

Bloggern (Permission `blogpost_poster`) zwei Werkzeugsaetze direkt neben dem
Editor anbieten:

1. **Privacy-Werkzeugkasten** — pro Post (und mit Profil-Defaults) regelbar,
   welche Form von Sichtbarkeit / Auffindbarkeit gilt. Spezielles Augenmerk:
   keine KI-Crawler, keine Suchindex-Findung, optional Token/Passwort-Zugang.
2. **Backup-Tresor** — mehrschichtig, defaults-on, der User soll davon
   moeglichst nichts mitkriegen, ausser einer dezenten "autosaved"-Notif und
   einer Crash-Recovery-Option.

Default fuer neue Posts: **public, indexierbar, ohne Token**. User schaltet
bewusst hoch.

## 1. Layout

- Linke Spalte (sticky neben Editor): zwei eigenstaendige SVG-Boxen
  untereinander, **Akkordeon** (nur eine ausgeklappt zur Zeit).
  - Oben — Privacy-Werkzeugkiste (offene Toolbox-SVG, Toggles als Werkzeuge).
  - Unten — Backup-Tresor (SVG eines Tresors mit Schloss).
- Rechte (Haupt-)Spalte: bestehender Editor + Format-Werkzeugkranz unveraendert.
- Mobile: beide Boxen oberhalb des Editors, gleiches Akkordeon.

## 2. Backup — User-Reibung minimieren

- Sichtbar im Editor: dezente Notif `autosaved <HH:MM>` (fade-out).
- Crash-Recovery beim Pageload: Browser-Draft vs. letzter Server-Stand
  vergleichen; falls Drift → Banner "Ungespeicherten Entwurf wiederherstellen?".
- Tresor-Box: Default **alle Schichten aktiv**, gruener Indikator. Klick =
  ausklappen, jede Schicht als Toggle + Status (zuletzt gesichert vor X min)
  + Info-`i`.
- Tieferes Management (alle Revisionen einsehen / restore / Papierkorb /
  Webhook-Konfiguration) lebt unter `/settings`, **nicht** im Editor.

### Backup-Schichten

| ID | Name                              | Zweck |
|----|-----------------------------------|-------|
| A1 | Browser-Draft (localStorage/IDB)  | Tippen ueberlebt Page-Reload / Crash |
| A2 | Server-Draft (debounced PATCH)    | Ueberlebt Browser-Crash und Geraetewechsel |
| A3 | Revisionshistorie pro Save        | Schuetzt vor versehentlicher Ueberschreibung |
| A4 | Soft-Delete + Papierkorb (30 d)   | Schuetzt vor versehentlichem Loeschen |
| A5 | Manueller Export (ZIP)            | User-Hand-Backup |
| A6 | (Cron-Snapshot) **gestrichen**    | redundant zu A2+A3 |
| A7 | Externer Mirror (Webhook / Repo)  | Off-Site, optional pro User |
| A8 | Doodle-Versionierung (in A3)      | Kritzel wird pro Revision mit gespeichert |
| A9 | Backup-Status-Health-Indicator    | Tresor-SVG zeigt gruen/gelb/rot |

### Backup-Popover-Achsen (fuer das `i`-Info pro Schicht)

- Ueberlebt Browser-Crash
- Ueberlebt versehentliches Loeschen
- Ueberlebt Server-Datenverlust
- Ueberlebt kompletten Account-Verlust
- Speicherverbrauch (klein/mittel/gross)
- Externes Konto noetig (nein/ja)
- Schreibt sofort / verzoegert / on-demand
- Manuell als Datei abrufbar

## 3. Privacy — Optionen-Katalog

### B1. Sichtbarkeitsstufen (eine aus vier)
- public — ueberall verlinkt, indexierbar (Default).
- unlisted — nur per Direkt-URL, nicht im Hub, nicht in Sitemap/RSS, kein OG.
- privat — Login-Pflicht (nur Autor sieht ihn; spaeter erweiterbar auf Freunde).
- passwortgeschuetzt — Shared-Secret-Token im URL-Param.

### B2. Crawler-Meta-Tags (SEO)
- `<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">`
- HTTP-Header zusaetzlich: `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`.

### B3. AI-Crawler-Meta (freiwillige Signals)
- `<meta name="robots" content="noai, noimageai">`
- `<meta name="ai-content-declaration" content="opt-out">`
- `<meta name="tdm-reservation" content="1">` (EU AI Act Art. 4 Abs. 3)
- HTTP-Header: `X-Robots-Tag: noai, noimageai` und `tdm-reservation: 1`.

### B4. AI-Crawler-UA-Gate (hart, Serverseite)
- Middleware auf `/posts/db/[id|slug]`: bei UA-Match → 403, leerer Body.
- Bot-Liste (toggelbar in Gruppen "KI", "Suchmaschinen", "Social-Preview"):
  `GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, anthropic-ai, Claude-Web,
  CCBot, Google-Extended, Googlebot, Bingbot, PerplexityBot, Bytespider,
  Amazonbot, FacebookBot, Meta-ExternalAgent, ImagesiftBot, Diffbot, Omgili,
  cohere-ai, YouBot, Applebot-Extended, DuckAssistBot, MistralAI-User`.

### B5. Dynamische robots.txt
- Neue Route `src/pages/robots.txt.js` rendert live aus DB.
- Globale Disallows fuer AI-Bots wenn User es generell ablehnt.
- Pro Post mit aktivem Toggle: `Disallow: /posts/db/<id|slug>`.

### B6. Sitemap-Opt-out
- `sitemap.xml.js` filtert Unlisted/Privat/AI-blockierte Posts raus.

### B7. RSS-Opt-out
- Posts mit aktivem AI-Toggle fliegen vollstaendig aus RSS-Feeds — kein
  Halb-Schritt mit Kurzfassung.

### B8. OG/Twitter-Card unterdruecken
- Bei Unlisted/Privat keine `og:*`/`twitter:*` Tags → kein Link-Preview.

### B9. Archiv-/Wayback-Opt-out
- Header `X-Archive-Disallow: 1`
- `Cache-Control: no-store, no-archive`
- `<meta name="archive" content="off">`

### B10. Referrer-Leak verhindern
- `<meta name="referrer" content="no-referrer">`
- Outbound-Links automatisch `rel="nofollow noreferrer noopener"`.
- Hinweis im Tooltip: vor allem fuer Posts mit nicht-ratbarer URL nuetzlich.

### B11. Embed-Verbot
- `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY`.

### B12. Doodle-Hotlink-Schutz
- Kritzelbild hinter `/api/posts/<id>/doodle` mit Referrer-/UA-Check.

### B13. Unguessbare URLs (Slug)
- `blog_posts.public_slug` (nanoid 12). Oeffentliche URL `/posts/db/<slug>`.
- Alte Integer-URLs: zunaechst Redirect, spaeter ggf. 410.
- Toggle "URL nicht ratbar".

### B14. Login-Wall
- Privat-Stufe oder eigener Toggle → Server-Render nur fuer eingeloggte User.

### B15. Shared-Secret-Token (siehe Token-Modell unten)

### B16. One-Time / Burn-after-reading (siehe Token-Modell)

### B17. Ablaufdatum
- `expires_at` → nach Ablauf 410 Gone oder Rueckfall auf Privat.

### B18. Soft-Anti-Scrape (kosmetisch)
- `user-select: none`, Rechtsklick-Verbot, Copy-Event-Cancel.
- Tooltip kennzeichnet ehrlich als "verlangsamt nur, kein Schutz".

### B19. Watermarking
- Halb-transparenter Username/Datum-Stempel ueber Text und Doodle.

### B20. Rate-Limit pro IP
- Middleware: max N Aufrufe/Minute auf `/posts/db/*`.

### B21. JS-only-Render (Notnagel)
- Server liefert leeres Skelett, Inhalt per authentifiziertem fetch.
- Bricht Suchmaschinen-Indexierung — nur fuer "voll versteckt"-Modus.

## 4. Antworten auf Detailfragen

**`noindex` vs. `noai`?** Decken unterschiedliche Bereiche ab.
- `noindex/nofollow` adressiert klassische Suchmaschinen-Indizes (Google-Suche,
  Bing).
- `Google-Extended` ist die separate Opt-Out-Direktive fuer
  Gemini-Training — unabhaengig vom Suchindex.
- `noai/noimageai` ist die generelle KI-Direktive, von einigen respektiert.
- Empfehlung: alle drei zusammen ausspielen, Kosten = 0 HTML-Bytes.

**Tags vs. UA-Gate?** Beides noetig.
- Tags = freiwillige Signals, wirken nur bei kompliantem Bot.
- UA-Gate = harter Riegel mit 403, wirkt bei jedem Bot mit ehrlichem UA.
- Gegen UA-Faelscher hilft nur Rate-Limit + Login + Token.

**RSS und AI-Schutz?** RSS-Inhalte sind faktisch ungeschuetzt — strukturierter
Volltext, Lieblingsfutter von Scrapern. Posts mit aktiven AI-Toggles fliegen
deshalb komplett aus dem Feed; kein "Kurzfassung im Feed" als Scheinsicherheit.

**`no-referrer` — wofuer?** Verhindert, dass beim Wegklicken auf externe Links
die eigene Post-URL im Referer-Header des Ziels auftaucht. Schuetzt nicht den
Post selbst, nur dessen Existenz/URL gegen indirekte Leaks. Sinnvoll nur fuer
Posts mit nicht-ratbarer URL. Kein Default, Bonus-Toggle.

**UA-Faelschung — Detail-Erklaerung:**
- UA = User-Agent-Header in jedem HTTP-Request, identifiziert den Client.
- Jeder HTTP-Client kann beliebigen Text setzen (curl `-A`, Python einzeiler).
- Mainstream-Crawler senden ehrlich (vertraglich/ethisch verpflichtet) — gegen
  die wirkt das UA-Gate.
- Aktive Boesewichte (Scraper, die sich als Chrome ausgeben) entkommen — gegen
  die wirken nur Rate-Limit (B20), Login-Wall (B14), Token-Pflicht (B15/16).
- Optional verschaerfbar: Reverse-DNS-Check (Googlebot loest auf
  `*.googlebot.com` auf) oder veroeffentlichte Crawler-IP-Listen — Phase 11.

**Full Screenshot-Disabling?** Im Browser nicht zuverlaessig moeglich, weil
OS-Screenshots auf Betriebssystem-Ebene laufen und JS nicht abfangen kann.
Realistisch:
- Visibility-API: bei Tab-Wechsel Inhalt blur → erschwert versehentliche Shots.
- Watermark (B19) → macht Bilder rueckverfolgbar.
- Canvas-/Image-Render-Modus → bricht Copy-Paste & Accessibility, nicht
  empfohlen ausser fuer extrem sensible Posts.
- DRM/EME → fuer Text nicht praktikabel.
- "View Source"-Erschwerung → schreckt Laien ab.
Im Tooltip ehrlich: "Schuetzt nicht gegen gezielte Screenshots. Nutze Token-
oder Login-Zugang fuer wirklich sensiblen Inhalt."

## 5. Token-Modell

Datenbanktabelle:

```
blog_post_tokens
  id           INTEGER PK
  owner_user   TEXT NOT NULL
  post_id      INTEGER NULL       -- NULL = User-globaler Token
  token_hash   TEXT UNIQUE NOT NULL   -- sha256 des Klartext-Tokens
  kind         TEXT NOT NULL      -- 'shared' | 'onetime'
  label        TEXT               -- "Fuer Freund Anna" / "Newsletter Juli"
  max_uses     INTEGER NULL       -- NULL = unbegrenzt
  used_count   INTEGER NOT NULL DEFAULT 0
  expires_at   TEXT NULL
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  revoked_at   TEXT NULL
```

Zwei Geltungsbereiche:
- **Post-spezifisch:** `post_id` gesetzt, oeffnet genau diesen Post. Mehrere
  Token pro Post moeglich (verschiedene Labels, einzeln widerrufbar).
- **User-global ("Hauptschluessel"):** `post_id = NULL`, oeffnet alle
  Token-only-Posts des Users — fuer festen Lesekreis.

Generierung:
- Server-seitig, kryptographisch (`crypto.randomUUID()` oder nanoid 24 base32).
- Endpoint `POST /api/posts/<id>/tokens` (post-spezifisch) bzw.
  `POST /api/user/tokens` (global).
- Klartext-Token nur einmalig im Response zurueckgegeben, DB speichert nur den
  sha256-Hash — DB-Leak gibt keinen Zugriff.

Verbrauch (One-Time):
- Bei jedem erfolgreichen Render `kind='onetime'`: `used_count++`. Wenn
  `used_count >= max_uses` (default 1) → kuenftige Requests 410 Gone.

UI in der Privacy-Toolbox:
- Toggle "Token-Zugang" aktiviert → Sub-Sektion mit Liste aktiver Token
  (Label, Typ, Verbrauch, Ablauf, Widerrufen-Knopf).
- "Neuen Token erzeugen"-Button → Mini-Modal mit Label, Typ, max_uses, Ablauf.
- Globale Token-Verwaltung in `/settings` unter "Globale Lesezugriffe".

Middleware-Check auf `/posts/db/[id|slug]`:
- Wenn Post Mode = token-only: `?key=<token>` validieren (sha256-Hash-Vergleich
  + expires_at + max_uses).
- Miss → **404** (nicht 401), damit die Existenz nicht verraten wird.

## 6. Profil-Ebene (`/me`)

`src/pages/me.astro` existiert bereits — Login-Pflichtige Seite, zeigt
`displayName + @username + Inventar/Graffiti-Layer`. **Public-Profil-Routen
`/u/<username>` existieren nicht.**

Memory-Luecke bestaetigt: `/me.astro` ist in `memory/memory.md` und
`memory/blogpost-editor.mdc` nicht erwaehnt. Beim ersten Code-Commit dieses
Plans wird ein Eintrag in `memory/memory.md` + neue `memory/profile-page.mdc`
(oder Erweiterung passender bestehender Datei) mitgepflegt.

Toggles auf Profil-Ebene:
- C1 Default-Privacy-Profil fuer neue Posts (Toggle-Vorbelegung).
- C2 Profilseite (`/me`) noindex / noai-pflichtig.
- C3 Anzeige-Name unabhaengig vom Login-Username.
- C4 Hub-Ausschluss (Posts dieses Users tauchen nie auf `blogpost.astro`-Hub).
- C5 "Ich bin gar nicht hier"-Modus (kein RSS/Sitemap/Suche/Hub).
- C6 Globaler Backup-Webhook (siehe A7).
- C7 Globaler "Alle KI-Crawler immer raus"-Toggle (ueberschreibt Post-Defaults).

## 7. Tooltip-/Info-Popover-System

Pro Toggle ein `i`-Icon. Tap/Hover → einheitliches Popover. Aufbau:
- Titel (Toggle-Name)
- Kurzbeschreibung (1-2 Saetze)
- Checkliste der Effekte gegen einen festen Achsenkatalog.

**Privacy-Effekt-Achsen (12 fix):**
1. Suchmaschinen-Index
2. AI-Crawler-Zugriff
3. Social-Media-Preview (OG/Twitter)
4. Im Hub gelistet
5. In RSS enthalten
6. In Sitemap enthalten
7. URL ratbar (Integer-ID vs. Slug)
8. Login noetig
9. Token noetig
10. Passwort noetig
11. Browser-/CDN-Cache erlaubt
12. Embed/Iframe erlaubt

Markierung je Achse: `✓ erlaubt` / `✗ blockiert` / `– unveraendert`.

**Backup-Effekt-Achsen (8):**
- Ueberlebt Browser-Crash
- Ueberlebt versehentliches Loeschen
- Ueberlebt Server-Datenverlust
- Ueberlebt kompletten Account-Verlust
- Speicherverbrauch (klein/mittel/gross)
- Externes Konto noetig
- Schreibt sofort/verzoegert/on-demand
- Manuell als Datei abrufbar

**Sammel-Status oben in jeder Box:** Aggregation aller aktiven Toggles als
"effektiver Zustand" des Posts/Backups, damit Kombinationswirkung sichtbar ist.

**Implementierung:** ein Component (`<InfoToggle>`) plus eine Daten-Tabelle
pro Bereich als Single Source of Truth, sowohl vom UI als auch von der
Server-Middleware genutzt:
- `src/lib/privacy-toggles.js`
- `src/lib/backup-layers.js`

## 8. Datenmodell

```
blog_posts (vorhanden, erweitern):
  + deleted_at        TEXT NULL                              -- A4
  + public_slug       TEXT UNIQUE                            -- B13
  + visibility        TEXT NOT NULL DEFAULT 'public'         -- B1
  + privacy_flags     TEXT NOT NULL DEFAULT '{}'             -- JSON-Bag aller Toggles
  + password_hash     TEXT NULL                              -- B15
  + expires_at        TEXT NULL                              -- B17

blog_post_revisions  (NEU)     -- A3
blog_post_drafts     (NEU)     -- A2
blog_post_tokens     (NEU)     -- B15/B16, siehe oben
blog_post_view_log   (NEU)     -- B20 Rate-Limit-Quelle
user_privacy_defaults (NEU)    -- C: pro-User-Standards + Webhook + Display-Name
```

`privacy_flags`-JSON-Beispiel:
```
{
  "noindex": true, "noai_meta": true, "noai_ua_gate": true,
  "no_archive": true, "no_referrer": false, "no_embed": true,
  "no_og": true, "soft_select": false, "watermark": false,
  "js_only": false, "rate_limit": true, "doodle_protect": true,
  "in_hub": false, "in_rss": false, "in_sitemap": false
}
```

## 9. API-Skizze

- `POST /api/posts/draft` / `GET /api/posts/draft` — A2.
- `GET /api/posts/<id>/revisions` / `POST /api/posts/<id>/restore?revision=<n>` — A3.
- `POST /api/posts/<id>/restore-trash` / hard-`DELETE` — A4.
- `GET /api/posts/export` — A5 (ZIP-Stream).
- `POST /api/posts/<id>/privacy` — Privacy-Flags toggeln.
- `POST /api/posts/<id>/tokens` / `DELETE /api/posts/<id>/tokens/<id>` — B15/16.
- `POST /api/user/tokens` / `DELETE` — global.
- `GET/PUT /api/user/privacy-defaults` — C.
- `GET /robots.txt` (dynamisch) — B5.
- `GET /sitemap.xml` — B6.
- Middleware auf `/posts/db/[id|slug]`: UA-Gate (B4), Visibility-Check (B1),
  Token-Check (B15), Expire-Check (B17), View-Log (B20).

## 10. Rollout-Reihenfolge

1. Datenmodell-Migration (idempotent in `ensureDbSchema`).
2. Backup-Basis (A1 + A2 + A3 + A4).
3. Visibility (B1) + Slug (B13) + Hub-Ausschluss.
4. Meta/Header-Privacy (B2 + B3 + B9 + B10 + B11).
5. UA-Gate + robots.txt (B4 + B5).
6. Toolbox-UI (SVG-Toolbox + SVG-Tresor + Akkordeon + Info-Popovers).
7. Profil-Ebene (C1 + C5 + C7).
8. Export (A5).
9. Token / Passwort / Expire / Burn (B15 + B16 + B17).
10. Watermark / Anti-Scrape-Soft / JS-only (B18 + B19 + B21).
11. Webhook-Mirror (A7), Rate-Limit (B20), Revisions-UI in `/settings`,
    optionaler Reverse-DNS-Verschaerfer fuer das UA-Gate.

## 11. Risiken / offene Punkte

- `document.execCommand` liefert unsanitiziertes HTML. Bei `js_only`-Render
  (B21) wird XSS-Sanitizing zwingend (isomorphic-dompurify-aequivalent).
- Slug-Migration alter Posts: erst zusaetzliche Slug-Spalte fuellen, dann
  301-Redirect, spaeter ggf. nur-Slug.
- Speicherbudget Revisionen: pro User Quote + automatisches Verdichten alter
  Revisionen einplanen.
- Memory-Pflege: `/me.astro` und alle neuen Tabellen/Routen muessen in
  `memory/memory.md` + passender `.mdc`-Datei mitwachsen (siehe CLAUDE.md
  Memory-Pflicht).
- Default fuer neue Posts bleibt **public/indexierbar/ohne Token** — User
  entscheidet bewusst.

## 12. Zusammenfassung der Aenderungen ggue. erstem Plan

- Layout: nicht zweispurig links/rechts, sondern Privacy + Tresor untereinander
  in einer linken Spalte, beide SVG-Illustration, Akkordeon.
- Backup-UX: dezente Notif + Crash-Recovery + Defaults-on, tieferes Management
  in `/settings`.
- Vercel-Cron-Snapshot (A6) gestrichen.
- Tooltip/Info-`i` einheitlich fuer Privacy **und** Backup.
- Token-Modell ausformuliert (DB, Geltungsbereiche, Hash-Speicherung,
  Endpoints, UI, 404-statt-401-Verhalten).
- Screenshot-Schutz ehrlich auf "weiches Hindernis" reduziert.
- `/me` als bestehende Profilseite identifiziert + Memory-Update vorgemerkt.
- Default "findbar/normal" bestaetigt.
- UA-Faelschung erklaert + Gegenmittel benannt (Rate-Limit, Login, Token).
