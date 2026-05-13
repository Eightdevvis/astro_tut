/**
 * src/lib/site-inventory-queue.js
 *
 * Serielle Promise-Kette für alle Inventar-Server-Mutations
 * (pickup / drop / swap / spawn / etc.). Optimistische UI bleibt sofort,
 * aber die Server-Calls laufen nacheinander. Damit kann eine Drop-Request
 * niemals den Server treffen bevor die vorherige Pickup-Request durch ist
 * — sonst sieht der Drop "hand=null" und failt mit 409, der Rollback klebt
 * das Item zurück in die Hand (das war der "spray buggt zurück" Bug).
 *
 * Modul-level state, weil das Inventar pro Tab eine eine einzige
 * Wahrheit ist und die zwei Components (SitePlacedItemsLayer, SiteInventory)
 * via window-events gekoppelt sind, aber sich keine Promise teilen können.
 */

let chain = Promise.resolve();

/**
 * Reiht eine async Operation in die globale Inventar-Queue ein.
 * Returns ein Promise das auflöst, sobald fn() durch ist.
 * Fehler in fn() unterbrechen die Kette NICHT — sonst würde ein einziger
 * 500er alle nachfolgenden Aktionen für immer blockieren.
 */
export function enqueueInventoryOp(fn) {
  const next = chain.then(() => Promise.resolve().then(fn));
  chain = next.catch(() => {});
  return next;
}
