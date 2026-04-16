# astro_tut — SASH

Persönliches Astro-Projekt mit Login-System, SQLite-Datenbank und eigenem Design.

## Setup

```sh
npm install
node scripts/init_db.cjs   # SQLite-Datenbank initialisieren (einmalig)
npm run dev
```

## Projektstruktur

```
/
├── public/
│   └── fonts/
│       ├── black spiral.ttf    # Hauptfont für das SASH-Logo
│       └── CrazyCurlz.ttf
├── scripts/
│   └── init_db.cjs             # Legt users.db und users-Tabelle an
├── src/
│   ├── components/
│   │   ├── Nav2.astro          # Haupt-Nav: MundIcon | SASH | LoginWidget
│   │   ├── LoginWidget.jsx     # Preact-Komponente: Login/Register/Logout
│   │   ├── QuoteDisplay.jsx    # Preact-Komponente: zufälliges Zitat anzeigen
│   │   └── ...
│   ├── layouts/
│   │   └── BaseLayout.astro    # HTML-Gerüst mit global.css
│   ├── pages/
│   │   ├── index.astro         # Startseite: schwarzer Hintergrund + Nav2 + Zitat
│   │   ├── quotes/
│   │   │   └── new.astro       # Zitat einreichen (braucht quote_poster-Recht)
│   │   └── api/
│   │       ├── quotes/
│   │       │   ├── add.js      # POST  — Zitat speichern (braucht quote_poster)
│   │       │   └── random.js   # GET   — zufälliges Zitat abrufen (öffentlich)
│   │       ├── login.js        # POST  — prüft Passwort, setzt JWT-Cookie
│   │       ├── register.js     # POST  — legt User an, setzt JWT-Cookie
│   │       ├── logout.js       # POST  — löscht Session-Cookie
│   │       └── user.js         # GET   — liest JWT-Cookie, gibt User zurück
│   └── styles/
│       ├── global.css          # Basis-CSS, importiert themes.css
│       └── themes.css          # CSS-Variablen für alle Themes
├── users.db                    # SQLite-Datenbank: users, user_permissions, quotes
└── astro.config.mjs            # SSR-Modus mit @astrojs/node Adapter
```

## Rechte-System

Jeder User kann Rechte haben. Rechte sind einfache Strings in der Tabelle `user_permissions`.

**Vollzugriff:** Recht `super_access` in `user_permissions` — `hasPermission(username, irgendetwas)` ist dann true (siehe `src/lib/permissions.js`). Zusätzlich hat der Login-Name aus **`SITE_SUPERUSER`** (Umgebungsvariable) dieselbe Wirkung; wenn unset/leer, Fallback **`sash`**. Logik nur in `permissions.js`.

| Recht | Beschreibung |
| :--- | :--- |
| `super_access` | Admin/Super-Einstellungen, globale RPG-Tools, Bugreport-Verwaltung |
| `quote_poster` | Darf Zitate auf der Startseite posten — Seite: `/quotes/new` |
| `tester_access` | Tester-Oberfläche (Bug-Screenshots) |
| `rpg_access` | RPG inkl. Questmaker |

**Nach Umstellung von älteren Deployments:** mindestens einem Account einmalig `super_access` in der DB setzen (z. B. per Turso/SQLite-Konsole), sonst ist `/super/settings` nicht erreichbar:

`INSERT OR IGNORE INTO user_permissions (username, permission) VALUES ('dein_admin_user', 'super_access');`

**Rechte erteilen/entziehen** (nur mit `super_access`):
```sh
# Recht erteilen
POST /api/admin/grant   { "username": "lea", "permission": "quote_poster" }

# Recht entziehen
POST /api/admin/revoke  { "username": "lea", "permission": "quote_poster" }
```

**Recht prüfen im Code:**
```js
import { hasPermission } from '../lib/permissions.js';
if (await hasPermission(username, 'quote_poster')) { ... }
```

**Neues Recht hinzufügen:**
1. In `src/lib/permissions.js` → `KNOWN_PERMISSIONS` eintragen
2. API-Route oder UI bauen die das Recht nutzt
3. `hasPermission()` aufrufen

## Auth-System

- **Datenbank:** SQLite (`users.db`), Tabelle `users` (id, username, birthday, password)
- **Passwort-Hashing:** bcryptjs mit salt-rounds=10
- **Session:** JWT (via `jose`), 7 Tage gültig, gesetzt als `httpOnly`-Cookie
- **Flow:** Register/Login → JWT generieren → Cookie setzen → `/api/user` verifiziert Cookie bei jedem Laden

## Commands

| Command | Aktion |
| :--- | :--- |
| `npm install` | Dependencies installieren |
| `node scripts/init_db.cjs` | Datenbank initialisieren (einmalig) |
| `npm run dev` | Dev-Server auf `localhost:4321` |
| `npm run build` | Produktions-Build nach `./dist/` |
| `npm run preview` | Build lokal vorschauen |
