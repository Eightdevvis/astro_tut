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

export function fireBackupWebhook(username, eventName, post) {
  if (!username) return;
  // fire-and-forget
  void (async () => {
    try {
      const defaults = await getUserPrivacyDefaults(username);
      const url = String(defaults?.backup_webhook_url || '').trim();
      if (!url) return;
      // Nur https zulassen — Plaintext-POST ueber http verbietet sich.
      if (!/^https?:\/\//i.test(url)) return;
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
