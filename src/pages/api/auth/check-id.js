import { isUserIdFree, findFreeUserId, slugifyForUserId, validateUserIdShape } from '../../../lib/user-id.js';

/**
 * GET /api/auth/check-id?id=...&name=...
 *
 * Wird vom Register-Modal beim Tippen aufgerufen.
 *
 *  - `id`: konkrete ID-Eingabe -> { available, shapeError, suggestion? }
 *  - `name`: Anzeigename -> { available, suggestion } basierend auf slugify(name).
 *
 * suggestion ist immer eine freie ID (falls die uebergebene belegt war).
 */
export async function GET({ url }) {
  const id = url.searchParams.get('id');
  const name = url.searchParams.get('name');

  if (id !== null) {
    const trimmed = String(id).trim();
    const shapeError = validateUserIdShape(trimmed);
    if (shapeError) {
      return new Response(JSON.stringify({ available: false, shapeError }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const available = await isUserIdFree(trimmed);
    const suggestion = available ? trimmed : await findFreeUserId(trimmed);
    return new Response(JSON.stringify({ available, suggestion }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (name !== null) {
    const slug = slugifyForUserId(name);
    const available = slug ? await isUserIdFree(slug) : false;
    const suggestion = available ? slug : await findFreeUserId(slug || 'user');
    return new Response(JSON.stringify({ available, suggestion }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'id oder name erforderlich' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
