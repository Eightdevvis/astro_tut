/**
 * src/lib/graffiti-client.js
 * Browser-seitige Helfer fuer das Tile-basierte Graffiti-System.
 *
 * Kein Server-Code hier — nur DOM/Canvas-Operationen. Diese Datei NICHT in
 * Server-Endpoints importieren (Buffer/document/Image existieren dort nicht
 * sauber).
 */

import { TILE_SIZE, tilesCoveringBounds } from './graffiti-tiles.js';

/** Re-export damit Komponenten nur eine import-Quelle brauchen. */
export { TILE_SIZE, tilesCoveringBounds };

/** Padding (in CSS-Pixel) das beim Bestimmen der betroffenen Tiles um die rohe
 *  Stroke-Bounding-Box rumgelegt wird. Beruecksichtigt Pinsel-Radius / Spray-Wolke /
 *  Schwamm-Radius — sonst wuerden die Tile-Updates die Effekte am Strich-Rand
 *  abschneiden. Etwas grosszuegig gewaehlt damit alles eingefangen ist. */
const STROKE_BOUNDS_PADDING = 32;

/**
 * Bestimmt die Bounding-Box eines Strokes inkl. Pinsel/Cloud/Erase-Radius.
 * Gibt {minX,minY,maxX,maxY} oder null zurueck (wenn keine validen Punkte).
 */
export function getStrokeBounds(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX: minX - STROKE_BOUNDS_PADDING,
    minY: minY - STROKE_BOUNDS_PADDING,
    maxX: maxX + STROKE_BOUNDS_PADDING,
    maxY: maxY + STROKE_BOUNDS_PADDING,
  };
}

/**
 * Laedt ein <img>-Element aus base64-PNG-Daten. Returnt erst wenn das Bild
 * dekodiert und gerendert werden kann (img.onload).
 *
 * Wirft bei Decode-Fehler — der Caller soll das einfach ueberspringen / loggen.
 */
export function loadTileImageFromBase64(pngBase64) {
  return new Promise((resolve, reject) => {
    if (!pngBase64) {
      reject(new Error('leeres pngBase64'));
      return;
    }
    const img = new Image();
    img.onerror = () => reject(new Error('PNG-Decode fehlgeschlagen'));
    img.src = `data:image/png;base64,${pngBase64}`;
    // img.decode() resolved erst wenn das Bild vollständig dekodiert UND
    // drawImage-ready ist. img.onload reicht in manchen Browsern nicht —
    // direkt nach onload kann drawImage transient blank rendern. Fallback
    // auf onload falls decode() nicht verfügbar (alte Browser).
    if (typeof img.decode === 'function') {
      img.decode().then(() => resolve(img)).catch(() => resolve(img));
    } else {
      img.onload = () => resolve(img);
    }
  });
}

/**
 * Holt alle Tiles einer Page vom Server.
 * Returnt { tileSize, tiles: Array<{x, y, version, image: HTMLImageElement, updatedAt}> }
 * — Tiles bei denen der PNG-Decode failed werden uebersprungen.
 */
export async function fetchTilesForPage(pagePath, fetchOpts = {}) {
  const url = `/api/graffiti/tiles?page=${encodeURIComponent(pagePath)}`;
  const res = await fetch(url, { credentials: 'same-origin', ...fetchOpts });
  if (!res.ok) throw new Error(`tiles fetch ${res.status}`);
  const data = await res.json().catch(() => ({}));
  const tileSize = Number(data?.tileSize) || TILE_SIZE;
  const rawTiles = Array.isArray(data?.tiles) ? data.tiles : [];

  const loaded = await Promise.all(
    rawTiles.map(async (t) => {
      try {
        const image = await loadTileImageFromBase64(String(t?.pngBase64 || ''));
        return {
          x: Number(t.x),
          y: Number(t.y),
          version: Number(t.version),
          image,
          updatedAt: String(t.updatedAt || ''),
        };
      } catch (err) {
        console.warn('[graffiti] Tile-Decode uebersprungen', t?.x, t?.y, err);
        return null;
      }
    })
  );
  return {
    tileSize,
    tiles: loaded.filter(Boolean),
  };
}

/**
 * Extrahiert die Region eines Tiles aus einem (DPR-skalierten) Base-Canvas
 * in ein 1x-CSS-Pixel-PNG. Gibt base64 (ohne data:-Prefix) zurueck.
 *
 * Ablauf:
 *  1) 512x512 offscreen-Canvas anlegen
 *  2) drawImage mit Source-Region in PHYSICAL pixels (DPR-skaliert) auf
 *     Destination 0..512, 0..512 — Browser skaliert automatisch runter.
 *  3) toBlob('image/png') -> arrayBuffer -> base64
 */
export async function extractTilePngBase64(baseCanvas, tileX, tileY, dpr) {
  const out = document.createElement('canvas');
  out.width = TILE_SIZE;
  out.height = TILE_SIZE;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('kein 2d-context fuer Tile-Export');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  const sx = tileX * TILE_SIZE * dpr;
  const sy = tileY * TILE_SIZE * dpr;
  const sw = TILE_SIZE * dpr;
  const sh = TILE_SIZE * dpr;
  octx.drawImage(baseCanvas, sx, sy, sw, sh, 0, 0, TILE_SIZE, TILE_SIZE);

  const blob = await new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob lieferte null'))), 'image/png');
  });
  const arrBuf = await blob.arrayBuffer();
  return arrayBufferToBase64(arrBuf);
}

/** ArrayBuffer -> base64 (ohne data:-Prefix). Chunkweise damit String.fromCharCode
 *  nicht bei grossen Buffern mit Stack-Overflow stirbt. Bei <=200KB ist das
 *  Pflicht-uebervorsichtig, schadet aber nicht. */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Postet einen Tile zum Server. Liefert {ok:true, version} bei Erfolg,
 * {ok:false, conflict:true, currentVersion} bei 409, {ok:false} sonst.
 */
export async function uploadTile({ pagePath, tileX, tileY, baseVersion, pngBase64, strokeBounds }) {
  const res = await fetch('/api/graffiti/tile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      pagePath,
      tileX,
      tileY,
      baseVersion,
      pngBase64,
      strokeBounds,
    }),
  });
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: true, version: Number(data?.version) || baseVersion + 1 };
  }
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, conflict: true, currentVersion: Number(data?.currentVersion) || 0 };
  }
  return { ok: false };
}
