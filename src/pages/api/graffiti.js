import { jwtVerify } from 'jose';
import { getDb, ensureDbSchema } from '../../lib/db.js';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';

const MAX_POINTS = 420;
const FADE_DAYS = 90;
const FUNCTIONAL_CLEAN_DAYS = 7;
const ERASE_RADIUS_PX = 26;
const ERASE_EDGE_SAMPLES = 64;
const STITCH_EPS_SQ = 3 * 3;

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Squared distance from point (px,py) to segment (x1,y1)-(x2,y2). */
function pointSegDistSq(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return distSq(px, py, x1, y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return distSq(px, py, x2, y2);
  const t = c1 / c2;
  const projX = x1 + t * vx;
  const projY = y1 + t * vy;
  return distSq(px, py, projX, projY);
}

function minDistSqToErasePolyline(px, py, erasePoints) {
  if (!Array.isArray(erasePoints) || erasePoints.length < 1) return Infinity;
  let m = Infinity;
  for (const ep of erasePoints) {
    const ex = Number(ep?.x);
    const ey = Number(ep?.y);
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
    m = Math.min(m, distSq(px, py, ex, ey));
  }
  for (let j = 1; j < erasePoints.length; j += 1) {
    const a = erasePoints[j - 1];
    const b = erasePoints[j];
    const x1 = Number(a?.x);
    const y1 = Number(a?.y);
    const x2 = Number(b?.x);
    const y2 = Number(b?.y);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
    m = Math.min(m, pointSegDistSq(px, py, x1, y1, x2, y2));
  }
  return m;
}

/** Punkt liegt im Schwamm-Schlauch (Spray). */
function pointNearErasePolyline(px, py, erasePoints, radiusSq) {
  return minDistSqToErasePolyline(px, py, erasePoints) <= radiusSq;
}

/** Teilstrecken von A–B, die ausserhalb des Radier-Schlauchs liegen (Endpunkte exakt auf der Originalkante). */
function clipEdgeOutsideErase(ax, ay, bx, by, erasePts, radiusSq) {
  const steps = ERASE_EDGE_SAMPLES;
  const outside = [];
  let outsideCount = 0;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    const isOutside = minDistSqToErasePolyline(px, py, erasePts) > radiusSq;
    outside.push(isOutside);
    if (isOutside) outsideCount += 1;
  }
  if (outsideCount === 0) return [];
  if (outsideCount === steps + 1) return [{ x1: ax, y1: ay, x2: bx, y2: by }];
  const segs = [];
  let s = null;
  for (let k = 0; k <= steps; k += 1) {
    if (outside[k]) {
      if (s === null) s = k;
    } else if (s !== null) {
      const e = k - 1;
      if (e >= s) {
        const t0 = s / steps;
        const t1 = e / steps;
        segs.push({
          x1: ax + (bx - ax) * t0,
          y1: ay + (by - ay) * t0,
          x2: ax + (bx - ax) * t1,
          y2: ay + (by - ay) * t1,
        });
      }
      s = null;
    }
  }
  if (s !== null) {
    const t0 = s / steps;
    segs.push({
      x1: ax + (bx - ax) * t0,
      y1: ay + (by - ay) * t0,
      x2: bx,
      y2: by,
    });
  }
  return segs;
}

function isFullEdgeClip(seg, ax, ay, bx, by) {
  return distSq(seg.x1, seg.y1, ax, ay) <= 4 && distSq(seg.x2, seg.y2, bx, by) <= 4;
}

function tagStrokeNeedsEraseUpdate(cleaned, erasePts, radiusSq) {
  if (cleaned.length < 2) return false;
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const a = cleaned[i];
    const b = cleaned[i + 1];
    const segs = clipEdgeOutsideErase(a.x, a.y, b.x, b.y, erasePts, radiusSq);
    if (segs.length === 0) return true;
    if (segs.length > 1) return true;
    if (!isFullEdgeClip(segs[0], a.x, a.y, b.x, b.y)) return true;
  }
  return false;
}

function stitchTagRunsPreservingShape(strokePoints, erasePts, radiusSq) {
  const cleaned = strokePoints
    .map((p) => ({ x: toInt(p?.x), y: toInt(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (cleaned.length < 2) return null;
  if (!tagStrokeNeedsEraseUpdate(cleaned, erasePts, radiusSq)) return null;

  const runs = [];
  let cur = [];

  function flushRun() {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  }

  function appendPoint(p) {
    if (cur.length > 0 && distSq(cur[cur.length - 1].x, cur[cur.length - 1].y, p.x, p.y) <= STITCH_EPS_SQ) return;
    cur.push(p);
  }

  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const a = cleaned[i];
    const b = cleaned[i + 1];
    const segs = clipEdgeOutsideErase(a.x, a.y, b.x, b.y, erasePts, radiusSq);
    if (segs.length === 0) {
      flushRun();
      continue;
    }
    for (const sg of segs) {
      const p0 = { x: sg.x1, y: sg.y1 };
      const p1 = { x: sg.x2, y: sg.y2 };
      if (cur.length === 0) {
        appendPoint(p0);
        appendPoint(p1);
      } else {
        const last = cur[cur.length - 1];
        if (distSq(last.x, last.y, p0.x, p0.y) <= STITCH_EPS_SQ) {
          appendPoint(p1);
        } else {
          flushRun();
          appendPoint(p0);
          appendPoint(p1);
        }
      }
    }
  }
  flushRun();
  if (runs.length === 0) return [];
  return runs;
}

function partialEraseSpray(strokePoints, erasePts, radiusSq) {
  return strokePoints.filter((p) => !pointNearErasePolyline(toInt(p?.x), toInt(p?.y), erasePts, radiusSq));
}

/** @returns {null | [] | Array<{x:number,y:number}[]>} null = unveraendert, [] = alles weg, sonst Teil-Polylines */
function partialEraseTagRuns(strokePoints, erasePts, radiusSq) {
  return stitchTagRunsPreservingShape(strokePoints, erasePts, radiusSq);
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function cleanPoints(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_POINTS)
    .map((p) => ({
      x: toInt(p?.x),
      y: toInt(p?.y),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) return '/';
  return raw.slice(0, 250);
}

async function cleanupGraffiti(db) {
  await db.execute({
    sql: `DELETE FROM graffiti_strokes
          WHERE created_at < datetime('now', ?)
             OR (is_functional = 1 AND created_at < datetime('now', ?))`,
    args: [`-${FADE_DAYS} days`, `-${FUNCTIONAL_CLEAN_DAYS} days`],
  });
}

export async function GET({ url }) {
  const pagePath = normalizePath(url.searchParams.get('page'));
  try {
    await ensureDbSchema();
    const db = getDb();
    await cleanupGraffiti(db);
    const result = await db.execute({
      sql: `SELECT id, mode, points_json, created_at
            FROM graffiti_strokes
            WHERE page_path = ?
            ORDER BY id ASC`,
      args: [pagePath],
    });
    const nowMs = Date.now();
    const strokes = (result.rows || []).map((row) => {
      let points = [];
      try {
        points = JSON.parse(String(row.points_json || '[]'));
      } catch {
        points = [];
      }
      const created = Date.parse(String(row.created_at || ''));
      const ageDays = Number.isFinite(created) ? (nowMs - created) / 86400000 : 0;
      return {
        id: Number(row.id),
        mode: String(row.mode || 'tag'),
        points,
        createdAt: String(row.created_at || ''),
        ageDays: Math.max(0, ageDays),
      };
    });
    return new Response(JSON.stringify({ success: true, strokes }), { status: 200 });
  } catch (err) {
    console.error('GET /api/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti konnte nicht geladen werden' }), { status: 500 });
  }
}

export async function POST({ request, cookies }) {
  const token = cookies.get('session')?.value;
  let username = 'anonymous';
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getJwtSecretBytes());
      const parsedUsername = String(payload.username || '').trim();
      if (parsedUsername) username = parsedUsername;
    } catch {
      // Invalid session tokens are ignored for public graffiti writes.
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  const pagePath = normalizePath(body?.pagePath);
  const modeRaw = String(body?.mode || 'tag').toLowerCase();
  const mode = modeRaw === 'spray' ? 'spray' : modeRaw === 'erase' ? 'erase' : 'tag';
  const points = cleanPoints(body?.points);
  const isFunctional = body?.isFunctional ? 1 : 0;

  try {
    await ensureDbSchema();
    const db = getDb();
    await cleanupGraffiti(db);

    if (mode === 'erase') {
      if (isFunctional) {
        return new Response(JSON.stringify({ error: 'Radieren dort nicht erlaubt' }), { status: 400 });
      }
      if (points.length < 1) {
        return new Response(JSON.stringify({ error: 'Zu wenig Punkte' }), { status: 400 });
      }
      const erasePts = points.length === 1 ? [points[0], points[0]] : points;
      const radiusSq = ERASE_RADIUS_PX * ERASE_RADIUS_PX;
      const existing = await db.execute({
        sql: `SELECT id, mode, points_json, username, is_functional, created_at FROM graffiti_strokes WHERE page_path = ?`,
        args: [pagePath],
      });

      let strokesUpdated = 0;

      for (const row of existing.rows || []) {
        const id = Number(row.id);
        if (!Number.isFinite(id)) continue;
        const sm = String(row.mode || 'tag');
        if (sm === 'erase') continue;

        let strokePoints = [];
        try {
          strokePoints = JSON.parse(String(row.points_json || '[]'));
        } catch {
          strokePoints = [];
        }
        const strokeUser = String(row.username || 'anonymous');
        const strokeFunctional = Number(row.is_functional) || 0;
        const strokeCreated = String(row.created_at || '');

        if (sm === 'spray') {
          const kept = partialEraseSpray(strokePoints, erasePts, radiusSq);
          if (kept.length === strokePoints.length) continue;
          strokesUpdated += 1;
          await db.execute({ sql: 'DELETE FROM graffiti_strokes WHERE id = ?', args: [id] });
          if (kept.length > 0) {
            await db.execute({
              sql: `INSERT INTO graffiti_strokes (page_path, username, mode, points_json, is_functional, created_at)
                    VALUES (?, ?, 'spray', ?, ?, ?)`,
              args: [pagePath, strokeUser, JSON.stringify(kept), strokeFunctional, strokeCreated],
            });
          }
          continue;
        }

        const tagRuns = partialEraseTagRuns(strokePoints, erasePts, radiusSq);
        if (tagRuns === null) continue;
        strokesUpdated += 1;
        await db.execute({ sql: 'DELETE FROM graffiti_strokes WHERE id = ?', args: [id] });
        for (const run of tagRuns) {
          if (run.length < 2) continue;
          await db.execute({
            sql: `INSERT INTO graffiti_strokes (page_path, username, mode, points_json, is_functional, created_at)
                  VALUES (?, ?, 'tag', ?, ?, ?)`,
            args: [pagePath, strokeUser, JSON.stringify(run), strokeFunctional, strokeCreated],
          });
        }
      }

      return new Response(JSON.stringify({ success: true, strokesUpdated }), { status: 200 });
    }

    if (points.length < 2) {
      return new Response(JSON.stringify({ error: 'Zu wenig Punkte' }), { status: 400 });
    }

    await db.execute({
      sql: `INSERT INTO graffiti_strokes (page_path, username, mode, points_json, is_functional)
            VALUES (?, ?, ?, ?, ?)`,
      args: [pagePath, username, mode, JSON.stringify(points), isFunctional],
    });
    return new Response(JSON.stringify({ success: true }), { status: 201 });
  } catch (err) {
    console.error('POST /api/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti speichern fehlgeschlagen' }), { status: 500 });
  }
}
