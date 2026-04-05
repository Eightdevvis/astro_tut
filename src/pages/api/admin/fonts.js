import { SUPERUSER } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { FONT_SETTING_KEYS, saveSiteFontSettings } from '../../../lib/site-font-settings.js';

export async function POST({ request, cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || caller !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const body = await request.json();
  const fonts = body.fonts && typeof body.fonts === 'object' ? body.fonts : {};
  const updates = {};
  for (const key of FONT_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fonts, key)) {
      updates[key] = fonts[key];
    }
  }
  await saveSiteFontSettings(updates);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
