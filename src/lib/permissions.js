/**
 * src/lib/permissions.js
 * Rechte mit Global-Default + per-User-Override.
 *
 * Modell:
 *  - `global_permissions` (PK permission): Existiert eine Zeile -> Permission ist global default-aktiv für alle.
 *  - `user_permissions` (UNIQUE(username, permission), state IN ('granted','revoked')):
 *      state='granted' = User hat das Recht ausdruecklich
 *      state='revoked' = User hat das Recht ausdruecklich NICHT (overridet globalen Default)
 *      keine Zeile     = User folgt dem globalen Default
 *  - `super_access`: implies all (DB-Zeile granted ODER global). Wird hier auch in der Loop unten beruecksichtigt.
 *
 * Effective(user, p) =
 *     state(user, p) === 'granted'                          -> true
 *  || state(user, p) === 'revoked'                          -> false
 *  || state(user, super_access) === 'granted'               -> true
 *  || state(user, super_access) === 'revoked'               -> false  (super_access selbst overridet, dann kein implizit)
 *  || globalActive(p)                                       -> true
 *  || globalActive(super_access)                            -> true
 *  || sonst                                                 -> false
 *
 * Zusaetzlich: Login-Name aus `SITE_SUPERUSER` (`.env` / Vercel) hat immer Vollzugriff.
 * Wenn unset oder leer -> Fallback `sash`. Nur diese Datei wertet das aus.
 *
 * RECHTE HINZUFUEGEN:
 * 1. Hier in KNOWN_PERMISSIONS eintragen
 * 2. hasPermission() an den passenden Stellen aufrufen
 */

import { getDb, ensureDbSchema } from './db.js';

/** DB-Wert; impliziert alle anderen Rechte bei hasPermission. */
export const SUPER_PERMISSION = 'super_access';

/** Effektiver Bootstrap-Name: Env `SITE_SUPERUSER` oder `sash`. */
function bootstrapSuperUsername() {
  const v = import.meta.env.SITE_SUPERUSER;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return 'sash';
}

function isBootstrapSuper(username) {
  return Boolean(username && username === bootstrapSuperUsername());
}

export const KNOWN_PERMISSIONS = [
  SUPER_PERMISSION,
  'quote_poster',
  'blogpost_poster',
  'tester_access',
  'rpg_access',
  'minigames_access',
  'feed_access',
];

function normalizeStateValue(raw) {
  const s = String(raw || 'granted');
  return s === 'revoked' ? 'revoked' : 'granted';
}

/**
 * Pure Effective-Berechnung — nimmt ownState-Map + Global-Set entgegen, nutzt keine DB.
 * Wird auch im Frontend gespiegelt (siehe SuperSettings.jsx#deriveEffectivePermissions).
 */
function computeEffectivePermissions(ownState, globalSet) {
  const out = [];
  const supState = ownState[SUPER_PERMISSION] ?? null;
  const supGlobal = globalSet.has(SUPER_PERMISSION);
  for (const p of KNOWN_PERMISSIONS) {
    const own = ownState[p] ?? null;
    if (own === 'granted') {
      out.push(p);
      continue;
    }
    if (own === 'revoked') continue;
    if (p !== SUPER_PERMISSION) {
      if (supState === 'granted') {
        out.push(p);
        continue;
      }
      if (supState !== 'revoked' && supGlobal) {
        out.push(p);
        continue;
      }
    }
    if (globalSet.has(p)) out.push(p);
  }
  return out;
}

function decideEffective(ownState, globalSet, permission) {
  const own = ownState[permission] ?? null;
  if (own === 'granted') return true;
  if (own === 'revoked') return false;
  if (permission !== SUPER_PERMISSION) {
    const sup = ownState[SUPER_PERMISSION] ?? null;
    if (sup === 'granted') return true;
    if (sup !== 'revoked' && globalSet.has(SUPER_PERMISSION)) return true;
  }
  return globalSet.has(permission);
}

/**
 * hasPermission(user, p): zwei parallele Queries, die alle relevanten States
 * fuer (p, super_access) auf einmal holen.
 */
export async function hasPermission(username, permission) {
  if (!username || !permission) return false;
  if (isBootstrapSuper(username)) return true;

  await ensureDbSchema();
  const db = getDb();
  const [ownRes, globalRes] = await Promise.all([
    db.execute({
      sql: `SELECT permission, state FROM user_permissions
            WHERE username = ? AND (permission = ? OR permission = ?)`,
      args: [username, permission, SUPER_PERMISSION],
    }),
    db.execute({
      sql: `SELECT permission FROM global_permissions
            WHERE permission = ? OR permission = ?`,
      args: [permission, SUPER_PERMISSION],
    }),
  ]);

  const ownState = {};
  for (const row of ownRes.rows) {
    ownState[row.permission] = normalizeStateValue(row.state);
  }
  const globalSet = new Set(globalRes.rows.map((r) => String(r.permission)));
  return decideEffective(ownState, globalSet, permission);
}

/**
 * Liefert die effektive Permissions-Liste eines Users mit zwei parallelen Queries
 * (alle States des Users + Global-Set), Berechnung lokal.
 */
export async function getPermissions(username) {
  if (!username) return [];
  if (isBootstrapSuper(username)) return [...KNOWN_PERMISSIONS];

  await ensureDbSchema();
  const db = getDb();
  const [ownRes, globalRes] = await Promise.all([
    db.execute({
      sql: 'SELECT permission, state FROM user_permissions WHERE username = ?',
      args: [username],
    }),
    db.execute({ sql: 'SELECT permission FROM global_permissions' }),
  ]);

  const ownState = {};
  for (const row of ownRes.rows) {
    ownState[row.permission] = normalizeStateValue(row.state);
  }
  const globalSet = new Set(globalRes.rows.map((r) => String(r.permission)));
  return computeEffectivePermissions(ownState, globalSet);
}

/**
 * Bulk-Load fuer das Admin-Panel: alle User + ihre effektiven Permissions +
 * ihre rohen Override-States in konstant vielen Queries (3 SELECTs, parallel).
 * Skaliert NICHT mit User-Zahl.
 */
export async function loadAllUsersWithPermissions() {
  await ensureDbSchema();
  const db = getDb();
  const [usersRes, statesRes, globalRes] = await Promise.all([
    db.execute('SELECT username, birthday FROM users ORDER BY username ASC'),
    db.execute('SELECT username, permission, state FROM user_permissions'),
    db.execute('SELECT permission FROM global_permissions'),
  ]);

  const globalSet = new Set(globalRes.rows.map((r) => String(r.permission)));
  const statesByUser = new Map();
  for (const row of statesRes.rows) {
    const u = String(row.username);
    let m = statesByUser.get(u);
    if (!m) {
      m = {};
      statesByUser.set(u, m);
    }
    m[row.permission] = normalizeStateValue(row.state);
  }

  return usersRes.rows.map((row) => {
    const username = String(row.username);
    const states = statesByUser.get(username) || {};
    const permissions = isBootstrapSuper(username)
      ? [...KNOWN_PERMISSIONS]
      : computeEffectivePermissions(states, globalSet);
    return {
      username,
      birthday: row.birthday,
      permissions,
      permissionStates: states,
    };
  });
}

/**
 * Roh-State pro User+Permission (ohne globalen Default eingerechnet).
 * 'granted' | 'revoked' | null. Fuer die SuperSettings-UI gedacht, damit Overrides
 * visualisiert werden koennen.
 */
export async function getUserPermissionStates(username) {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT permission, state FROM user_permissions WHERE username = ?',
    args: [username],
  });
  const map = {};
  for (const row of r.rows) {
    map[row.permission] = normalizeStateValue(row.state);
  }
  return map;
}

/** Liste aller Permissions mit aktiver "beware of bugs"-Warnung. */
export async function getPermissionWarnings() {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT permission FROM permission_warnings ORDER BY permission ASC',
  });
  return r.rows.map((x) => String(x.permission));
}

/** Setzt ob eine Permission die "beware of bugs"-Warnung anzeigen soll. */
export async function setPermissionWarning(permission, active) {
  await ensureDbSchema();
  const db = getDb();
  if (active) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO permission_warnings (permission) VALUES (?)',
      args: [permission],
    });
  } else {
    await db.execute({
      sql: 'DELETE FROM permission_warnings WHERE permission = ?',
      args: [permission],
    });
  }
}

/** Schneller Check fuer eine einzelne Permission (z. B. fuer Astro-Frontmatter). */
export async function hasPermissionWarning(permission) {
  if (!permission) return false;
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT 1 FROM permission_warnings WHERE permission = ? LIMIT 1',
    args: [permission],
  });
  return r.rows.length > 0;
}

/** Liste aller global-aktiven Permissions. */
export async function getGlobalPermissions() {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT permission FROM global_permissions ORDER BY permission ASC',
  });
  return r.rows.map((x) => String(x.permission));
}

/** Setzt ob eine Permission global-aktiv ist. */
export async function setGlobalPermission(permission, active) {
  await ensureDbSchema();
  const db = getDb();
  if (active) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO global_permissions (permission) VALUES (?)',
      args: [permission],
    });
  } else {
    await db.execute({
      sql: 'DELETE FROM global_permissions WHERE permission = ?',
      args: [permission],
    });
  }
}

/**
 * grantPermission: User soll dieses Recht haben.
 *  - Wenn die Permission global-aktiv ist -> reicht es, einen evtl. revoke-Override
 *    zu entfernen (DELETE). So bleibt die Tabelle schlank.
 *  - Sonst: state='granted' upserten.
 */
export async function grantPermission(username, permission) {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT 1 FROM global_permissions WHERE permission = ? LIMIT 1',
    args: [permission],
  });
  const globallyActive = r.rows.length > 0;
  if (globallyActive) {
    await db.execute({
      sql: 'DELETE FROM user_permissions WHERE username = ? AND permission = ?',
      args: [username, permission],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO user_permissions (username, permission, state) VALUES (?, ?, 'granted')
          ON CONFLICT(username, permission) DO UPDATE SET state = 'granted'`,
    args: [username, permission],
  });
}

/**
 * revokePermission: User soll dieses Recht NICHT haben.
 *  - Wenn die Permission global-aktiv ist -> Override mit state='revoked' upserten.
 *  - Sonst: jegliche Zeile loeschen (kein Recht = kein Eintrag noetig).
 */
export async function revokePermission(username, permission) {
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT 1 FROM global_permissions WHERE permission = ? LIMIT 1',
    args: [permission],
  });
  const globallyActive = r.rows.length > 0;
  if (globallyActive) {
    await db.execute({
      sql: `INSERT INTO user_permissions (username, permission, state) VALUES (?, ?, 'revoked')
            ON CONFLICT(username, permission) DO UPDATE SET state = 'revoked'`,
      args: [username, permission],
    });
    return;
  }
  await db.execute({
    sql: 'DELETE FROM user_permissions WHERE username = ? AND permission = ?',
    args: [username, permission],
  });
}
