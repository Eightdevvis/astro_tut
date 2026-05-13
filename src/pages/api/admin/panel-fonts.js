import { hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { buildFontCatalog, getCustomFontFacesCss } from '../../../lib/font-catalog.js';
import { getAllSiteFontSettings } from '../../../lib/site-font-settings.js';

/** Lazy-Sub-Endpoint fuer den Fonts-Tab — wird nicht zusammen mit /panel geladen. */
export async function GET({ cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || !(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const [fonts, fontCatalog, fontPreviewCss] = await Promise.all([
    getAllSiteFontSettings(),
    buildFontCatalog(),
    getCustomFontFacesCss(),
  ]);

  return new Response(
    JSON.stringify({ fonts, fontCatalog, fontPreviewCss }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
