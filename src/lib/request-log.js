/**
 * request_log Writer — schreibt eine Zeile pro oeffentlichem
 * Detail-Request. Wird vom Detail-Pfad nach dem Privacy-/Gate-Check
 * aufgerufen, damit auch geblockte Requests gezaehlt werden.
 *
 * Vermeidet, dass eine kaputte Logging-Stelle die ganze Page killt:
 * `safeLogRequest` schluckt alle Fehler und loggt sie nur in die
 * Konsole.
 */

import { createHash } from 'node:crypto';
import { ensureDbSchema, getDb } from './db.js';
import { classifyUserAgent } from './bot-fingerprints.js';

function readEnv(key) {
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[key];
    if (v != null && v !== '') return v;
  }
  try {
    const v = import.meta.env?.[key];
    if (v != null && v !== '') return v;
  } catch {}
  return undefined;
}

/**
 * Salt fuer IP-Hashes. Default ist projekt-fix; in Prod kann SASHA via
 * REQUEST_LOG_IP_SALT einen geheimen Wert setzen. Wird (laut Plan)
 * monatlich rotiert — Cadence steht in memory/security-sensitive.md.
 */
function ipSalt() {
  return readEnv('REQUEST_LOG_IP_SALT') || 'astro-tut-default-salt-v1';
}

/**
 * Hasht die IP mit dem Salt. Auch fuer leere IPs robust — gibt dann
 * den Hash des Salts zurueck (alle leeren IPs landen so in derselben
 * Bucket; das ist OK fuer Rate-Limits, Datenschutz bleibt gewahrt).
 */
export function hashIp(ip) {
  return createHash('sha256').update(`${ipSalt()}|${String(ip || '')}`).digest('hex').slice(0, 32);
}

/**
 * Extrahiert IP/Country/UA/Referer aus dem Astro-Request-/Header-Objekt.
 * Funktioniert lokal (X-Forwarded-* leer) und auf Vercel (Edge-Header
 * gesetzt).
 *
 * K2: Reihenfolge ist **wichtig** fuers Rate-Limit. Ein Client kann
 * `X-Forwarded-For` frei setzen — und Vercel haengt seine echte IP
 * **hinten** an, statt sie zu ersetzen. Wer XFF[0] nimmt, sieht also
 * weiter den Spoof-Wert. `x-real-ip` setzt Vercel selbst und ueber-
 * schreibt eingehende Werte, ist also manipulationsfest. Fallback fuer
 * Cases ohne `x-real-ip`: der LETZTE XFF-Eintrag (= der Vercel-stamped
 * Wert), nicht der erste.
 */
export function extractClientMeta(request, clientAddress) {
  const headers = request?.headers;
  const get = (name) => (headers?.get ? headers.get(name) : '') || '';
  const xffList = get('x-forwarded-for').split(',').map((s) => s.trim()).filter(Boolean);
  const xffLast = xffList.length > 0 ? xffList[xffList.length - 1] : '';
  const realIp = get('x-real-ip');
  const ip = realIp || xffLast || clientAddress || '';
  return {
    ua: get('user-agent'),
    country: get('x-vercel-ip-country') || null,
    referer: get('referer') || null,
    ip,
  };
}

/**
 * Schreibt eine Zeile in request_log. Tolerant gegen jeden Fehler —
 * Logging darf den User-Request nie zerschiessen.
 */
export async function safeLogRequest({
  path,
  postId = null,
  username = null,
  ua,
  ip,
  country = null,
  referer = null,
  status,
  blockedReason = null,
}) {
  try {
    await ensureDbSchema();
    const { category, botName } = classifyUserAgent(ua);
    await getDb().execute({
      sql: `INSERT INTO request_log
              (path, post_id, username, ua_string, ua_category, ua_bot_name,
               ip_hash, country, referer, status, blocked_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        String(path || ''),
        postId,
        username,
        String(ua || '').slice(0, 1024),
        category,
        botName,
        hashIp(ip),
        country,
        referer ? String(referer).slice(0, 512) : null,
        Number(status) || 0,
        blockedReason,
      ],
    });
  } catch (err) {
    console.warn('[request_log] write failed', err?.message || err);
  }
}
