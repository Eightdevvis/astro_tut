/**
 * A7 — Webhook-Mirror.
 *
 * Wenn der User in seinen Privacy-Defaults eine `backup_webhook_url`
 * konfiguriert hat, POSTen wir nach jedem erfolgreichen Save ein JSON
 * dorthin. Fire-and-forget: das eigentliche Save darf nie blockiert
 * werden, Fehler landen nur im Server-Log.
 *
 * Payload-Format (`X-Astro-Tut-Event`):
 *   {
 *     event: 'post.add' | 'post.update' | 'post.delete' | 'post.restore',
 *     username: string,
 *     postId: number,
 *     publicSlug: string | null,
 *     visibility: string,
 *     contentText: string,
 *     contentHtml: string,
 *     occurredAt: ISO-Timestamp,
 *   }
 */

import { getUserPrivacyDefaults } from './user-privacy-defaults.js';

// H3 — SSRF-Schutz. Blockt Webhook-URLs, die auf private oder
// Link-Local-Netze zeigen. Auch bekannte Metadata-Endpoints von AWS,
// GCP, DigitalOcean.
const SSRF_FORBIDDEN_HOSTS = new Set([
  'localhost',
  // AWS / GCP / DO / Alibaba Metadata-Service
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
]);

const SSRF_FORBIDDEN_HOST_REGEXP = [
  /^127\./,                   // IPv4 loopback
  /^10\./,                    // RFC1918
  /^192\.168\./,              // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^169\.254\./,              // Link-local IPv4
  /^0\./,                     // current network
  /^::1$/,                    // IPv6 loopback
  /^fc[0-9a-f][0-9a-f]:/i,    // IPv6 ULA
  /^fd[0-9a-f][0-9a-f]:/i,    // IPv6 ULA
  /^fe80:/i,                  // IPv6 link-local
];

/**
 * Wirft, wenn der Hostname auf eine private/loopback/metadata-Adresse
 * zeigt. Keine DNS-Aufloesung — der Hostname wird literal geprueft.
 * Wer eine externe Domain auf 127.0.0.1 zeigen laesst (DNS-Rebinding)
 * kann den Check umgehen; das ist ein bekanntes Restrisiko.
 */
function ensureWebhookHostAllowed(parsed) {
  const host = String(parsed.hostname || '').toLowerCase();
  if (!host) throw new Error('no host');
  if (SSRF_FORBIDDEN_HOSTS.has(host)) {
    throw new Error(`forbidden host: ${host}`);
  }
  for (const re of SSRF_FORBIDDEN_HOST_REGEXP) {
    if (re.test(host)) throw new Error(`forbidden host range: ${host}`);
  }
}

export function fireBackupWebhook(username, eventName, post) {
  if (!username) return;
  // fire-and-forget
  void (async () => {
    try {
      const defaults = await getUserPrivacyDefaults(username);
      const url = String(defaults?.backup_webhook_url || '').trim();
      if (!url) return;
      // H3: HTTPS-Pflicht — http:// koennte sonst auf private Endpoints
      // zeigen ohne TLS-Schutz.
      let parsed;
      try { parsed = new URL(url); } catch { return; }
      if (parsed.protocol !== 'https:') {
        console.warn('[backup-webhook] non-https rejected:', parsed.protocol);
        return;
      }
      try { ensureWebhookHostAllowed(parsed); }
      catch (err) {
        console.warn('[backup-webhook] SSRF-block:', err?.message || err);
        return;
      }
      const body = {
        event: eventName,
        username,
        occurredAt: new Date().toISOString(),
        postId: post?.id ?? null,
        publicSlug: post?.public_slug ?? null,
        visibility: post?.visibility ?? null,
        contentText: post?.content_text ?? null,
        contentHtml: post?.content_html ?? null,
      };
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Astro-Tut-Event': eventName,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        console.warn('[backup-webhook] POST failed', err?.message || err);
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      console.warn('[backup-webhook] aborted', err?.message || err);
    }
  })();
}
