/**
 * src/lib/graffiti-upload-queue.js
 *
 * Serielle Promise-Kette für Tile-Uploads. Strokes komprimieren sich nicht
 * mehr gegenseitig: ein Upload-Batch (= ein Stroke) wartet auf den vorigen.
 *
 * Warum nötig: parallele Uploads lesen jeweils `version` aus dem lokalen
 * tilesRef — wenn Stroke 1 noch nicht zurückgeschrieben hat, sieht Stroke 2
 * die alte Version, schickt baseVersion=N, Server ist aber schon bei N+1
 * → 409. Der Code fiel dann auf "hard reload aller Tiles" zurück, wodurch
 * frische Erase-Pixel verschwanden ("schwamm-revert"-Bug).
 *
 * Modul-level state, damit alle GraffitiLayer-Instanzen sich denselben Slot
 * teilen (in der Praxis gibt's nur eine Instance pro Page).
 */

import { dbg } from './graffiti-debug.js';

let chain = Promise.resolve();
let depth = 0;
let nextTaskId = 0;

export function getUploadQueueDepth() {
  return depth;
}

/**
 * Reiht eine async Upload-Operation ein. Returns Promise das auflöst sobald
 * fn() durch ist. Fehler in fn() unterbrechen die Kette NICHT.
 */
export function enqueueTileUpload(fn) {
  const taskId = ++nextTaskId;
  depth += 1;
  dbg('upload-queue-enqueue', { taskId, depthAfter: depth });
  const next = chain.then(() => {
    dbg('upload-queue-start', { taskId, depthAtStart: depth });
    return Promise.resolve().then(fn);
  }).finally(() => {
    depth -= 1;
    dbg('upload-queue-done', { taskId, depthAfter: depth });
  });
  chain = next.catch(() => {});
  return next;
}
