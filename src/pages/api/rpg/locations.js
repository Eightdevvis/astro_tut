import { ensureDbSchema } from '../../../lib/db.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { listRpgLocations, upsertRpgLocation } from '../../../lib/rpg-location-catalog-db.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || !(await hasPermission(username, 'super_access'))) return forbidden();
  await ensureDbSchema();
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const action = typeof body?.action === 'string' ? body.action.trim() : 'upsertSingle';

  if (action === 'upsertHierarchy') {
    const countryName = typeof body?.countryName === 'string' ? body.countryName.trim() : '';
    const cityName = typeof body?.cityName === 'string' ? body.cityName.trim() : '';
    const placeName = typeof body?.placeName === 'string' ? body.placeName.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';

    if (!countryName || !cityName || !placeName) {
      return new Response(
        JSON.stringify({ error: 'countryName, cityName und placeName sind Pflicht.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const country = await upsertRpgLocation({
      kind: 'country',
      name: countryName,
      country: countryName,
    });
    const city = await upsertRpgLocation({
      kind: 'city',
      name: cityName,
      city: cityName,
      country: countryName,
    });
    const place = await upsertRpgLocation({
      kind: 'place',
      name: placeName,
      city: cityName,
      country: countryName,
      description,
    });
    if (!country || !city || !place) {
      return new Response(JSON.stringify({ error: 'Orts-Hierarchie konnte nicht erstellt werden.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, country, city, place }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kind = body?.kind === 'country' ? 'country' : body?.kind === 'place' ? 'place' : 'city';
  const row = await upsertRpgLocation({
    kind,
    name: body?.name,
    description: body?.description,
    city: body?.city,
    country: body?.country,
  });
  if (!row) {
    return new Response(JSON.stringify({ error: 'Name fehlt' }), { status: 400 });
  }
  return new Response(JSON.stringify({ ok: true, location: row }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function searchTokens(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!s) return [];
  return s.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * @param {string} value
 * @param {string} token
 * @param {number} prefixW
 * @param {number} substrW
 */
function tokenScore(value, token, prefixW, substrW) {
  const v = value.toLowerCase();
  if (!v.includes(token)) return 0;
  if (v === token) return prefixW + substrW + 30;
  if (v.startsWith(token)) return prefixW;
  return substrW;
}

/**
 * Ein zentraler Suchstring matcht gegen Land-, Stadt- und Ortsfelder; Score höher = relevanter.
 * @param {{ id: string; kind: string; name: string; city: string; country: string; description: string; updatedAt: string }} row
 * @param {string[]} tokens
 */
function suggestionScore(row, tokens) {
  if (!tokens.length) return -1;
  const name = row.name || '';
  const city = row.city || '';
  const country = row.country || '';
  let score = 0;
  for (const t of tokens) {
    let best = 0;
    if (row.kind === 'country') {
      best = Math.max(best, tokenScore(name, t, 120, 55));
    } else if (row.kind === 'city') {
      best = Math.max(
        best,
        tokenScore(name, t, 100, 45),
        tokenScore(country, t, 70, 30)
      );
    } else {
      best = Math.max(
        best,
        tokenScore(name, t, 110, 50),
        tokenScore(city, t, 85, 40),
        tokenScore(country, t, 65, 28)
      );
    }
    if (best === 0) return -1;
    score += best;
  }
  if (row.kind === 'place') score += 8;
  else if (row.kind === 'city') score += 4;
  return score;
}

/**
 * Vorschläge für genau ein Feld (Neu-anlegen-Autocomplete): nur eine Kind-Zeile.
 * Bei `place` wird nur der Ortsname gematcht, nicht Stadt/Land (kein „Berlin“ in der Ort-Leiste).
 * @param {{ id: string; kind: string; name: string; city: string; country: string; description: string; updatedAt: string }} row
 * @param {string[]} tokens
 * @param {'country' | 'city' | 'place'} fieldKind
 */
function suggestionScoreSingleField(row, tokens, fieldKind) {
  if (row.kind !== fieldKind || !tokens.length) return -1;
  let score = 0;
  for (const t of tokens) {
    let best = 0;
    if (fieldKind === 'country') {
      best = tokenScore(row.name, t, 120, 55);
    } else if (fieldKind === 'city') {
      best = Math.max(tokenScore(row.name, t, 100, 45), tokenScore(row.country, t, 72, 28));
    } else {
      best = tokenScore(row.name, t, 110, 50);
    }
    if (best === 0) return -1;
    score += best;
  }
  if (fieldKind === 'place') score += 6;
  else if (fieldKind === 'city') score += 3;
  return score;
}

/** @param {string} a @param {string} b */
function normEq(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function GET({ url, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || !(await hasPermission(username, 'rpg_access'))) return forbidden();
  await ensureDbSchema();
  const qUnified = url.searchParams.get('q')?.trim() || '';
  const tokens = searchTokens(qUnified);
  const fieldKindRaw = url.searchParams.get('kind')?.trim().toLowerCase() || '';
  const fieldKind =
    fieldKindRaw === 'country' || fieldKindRaw === 'city' || fieldKindRaw === 'place' ? fieldKindRaw : '';
  const inCountry = url.searchParams.get('inCountry')?.trim() || '';
  const inCity = url.searchParams.get('inCity')?.trim() || '';

  const rows = await listRpgLocations();

  const countries = [...new Set(rows.filter((r) => r.kind === 'country').map((r) => r.name))].sort((a, b) =>
    a.localeCompare(b)
  );
  const cities = [...new Set(rows.filter((r) => r.kind === 'city').map((r) => `${r.country}||${r.name}`))]
    .map((x) => {
      const [country, name] = x.split('||');
      return { country, name };
    })
    .sort((a, b) => (a.country + a.name).localeCompare(b.country + b.name));

  /** @type {{ row: { id: string; kind: string; name: string; city: string; country: string; description: string; updatedAt: string }; score: number }[]} */
  const scored = [];
  /** @type {{ row: { id: string; kind: string; name: string; city: string; country: string; description: string; updatedAt: string }; score: number }[]} */
  const scoredField = [];

  if (fieldKind && tokens.length > 0) {
    for (const row of rows) {
      if (fieldKind === 'city' && inCountry && row.kind === 'city' && !normEq(row.country, inCountry)) continue;
      if (fieldKind === 'place' && row.kind === 'place') {
        if (inCountry && !normEq(row.country, inCountry)) continue;
        if (inCity && !normEq(row.city, inCity)) continue;
      }
      const score = suggestionScoreSingleField(row, tokens, fieldKind);
      if (score >= 0) scoredField.push({ row, score });
    }
    scoredField.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  } else if (tokens.length > 0) {
    for (const row of rows) {
      const score = suggestionScore(row, tokens);
      if (score >= 0) scored.push({ row, score });
    }
    scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  }

  const suggestions = (fieldKind ? scoredField : scored).slice(0, 48).map(({ row, score }) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    city: row.city,
    country: row.country,
    description: row.description,
    score,
  }));

  const qCountry = url.searchParams.get('country')?.trim().toLowerCase() || '';
  const qCity = url.searchParams.get('city')?.trim().toLowerCase() || '';
  const qPlace = url.searchParams.get('place')?.trim().toLowerCase() || '';
  const places = rows
    .filter((r) => r.kind === 'place')
    .filter((r) => (qCountry ? r.country.toLowerCase().includes(qCountry) : true))
    .filter((r) => (qCity ? r.city.toLowerCase().includes(qCity) : true))
    .filter((r) => (qPlace ? r.name.toLowerCase().includes(qPlace) : true))
    .slice(0, 50);

  return new Response(JSON.stringify({ ok: true, countries, cities, places, suggestions }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
