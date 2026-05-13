import {
  loadAllUsersWithPermissions,
  getGlobalPermissions,
  getPermissionWarnings,
  KNOWN_PERMISSIONS,
  hasPermission,
} from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { getTesterUiPreference } from '../../../lib/tester-ui-preference.js';

/**
 * Liefert nur die Daten, die der Default-Tab (Nutzer-Rechte) sofort braucht.
 * Fonts und Bug-Reports werden separat ueber /api/admin/panel-fonts bzw.
 * /api/admin/panel-tester-bugs nachgezogen (lazy / background prefetch).
 */
export async function GET({ cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || !(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const [users, globalPermissions, permissionWarnings, testerUiEnabled] = await Promise.all([
    loadAllUsersWithPermissions(),
    getGlobalPermissions(),
    getPermissionWarnings(),
    getTesterUiPreference(caller),
  ]);

  return new Response(
    JSON.stringify({
      users,
      knownPermissions: KNOWN_PERMISSIONS,
      globalPermissions,
      permissionWarnings,
      testerUiEnabled,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
