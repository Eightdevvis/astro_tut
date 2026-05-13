/**
 * SitePlacedItemsLayer — rendert die auf der aktuellen Seite "liegenden"
 * Items. Klick auf ein Item → POST pickup → Item kommt in die User-Hand,
 * Server-Antwort aktualisiert das Inventar über das site-inventory-update-
 * Event, das SiteInventory abfängt.
 *
 * Liegende Items sind PUBLIC sichtbar (auch ohne Login), aber Pickup
 * erfordert einen eingeloggten User (Server gibt 401 zurück → wir ignorieren
 * den Klick stillschweigend für Anonyme).
 */
import { useEffect, useRef, useState } from 'preact/hooks';

function iconForItem(item) {
  if (!item) return '📦';
  const sm = item.config?.strokeMode;
  if (sm === 'erase') return '🧽';
  if (sm === 'spray') return '🧯';
  if (item.kind === 'stamp') return '🪧';
  if (item.kind === 'sticker') return '🏷️';
  if (item.kind === 'key') return '🔑';
  if (item.kind === 'pen') return '✎';
  return '📦';
}

export default function SitePlacedItemsLayer() {
  const [items, setItems] = useState([]);
  const pagePathRef = useRef(typeof location !== 'undefined' ? location.pathname : '/');

  async function loadItems() {
    const pagePath = pagePathRef.current;
    try {
      const res = await fetch(`/api/site-placed-items?page=${encodeURIComponent(pagePath)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.items)) setItems(data.items);
    } catch (err) {
      console.warn('[site-placed-items] load failed', err);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  // Externe Trigger:
  // - 'dirty' = voller Reload (alte Compat-Hook, derzeit kein Caller mehr)
  // - 'add' = optimistisches Anhängen eines Items mit Temp-ID
  // - 'remove' = optimistisches Entfernen (z.B. Rollback nach failed drop)
  // - 'replace-id' = Temp-ID gegen echte Server-ID tauschen, sobald Server antwortet
  useEffect(() => {
    function onDirty(e) {
      const targetPage = e?.detail?.pagePath;
      if (targetPage && targetPage !== pagePathRef.current) return;
      void loadItems();
    }
    function onAdd(e) {
      const item = e?.detail?.item;
      if (!item || typeof item !== 'object') return;
      setItems((prev) => [...prev, item]);
    }
    function onRemove(e) {
      const id = e?.detail?.placedItemId;
      if (id == null) return;
      setItems((prev) => prev.filter((it) => it.placedItemId !== id));
    }
    function onReplaceId(e) {
      const { tempId, realId } = e?.detail || {};
      if (tempId == null || realId == null) return;
      setItems((prev) =>
        prev.map((it) => (it.placedItemId === tempId ? { ...it, placedItemId: realId } : it))
      );
    }
    window.addEventListener('site-placed-items-dirty', onDirty);
    window.addEventListener('site-placed-items-add', onAdd);
    window.addEventListener('site-placed-items-remove', onRemove);
    window.addEventListener('site-placed-items-replace-id', onReplaceId);
    return () => {
      window.removeEventListener('site-placed-items-dirty', onDirty);
      window.removeEventListener('site-placed-items-add', onAdd);
      window.removeEventListener('site-placed-items-remove', onRemove);
      window.removeEventListener('site-placed-items-replace-id', onReplaceId);
    };
  }, []);

  async function onItemClick(placedItemId, e) {
    e.stopPropagation();
    e.preventDefault();
    // Vollständig optimistisch: Item lokal entfernen UND SiteInventory sofort
    // mitteilen, dass die Hand jetzt belegt ist — Cursor-Follower + Body-Class
    // greifen instant, ohne auf den Turso-Roundtrip zu warten.
    let removed = null;
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.placedItemId === placedItemId);
      if (idx < 0) return prev;
      removed = prev[idx];
      return prev.filter((_, i) => i !== idx);
    });
    if (!removed) return;
    window.dispatchEvent(
      new CustomEvent('site-inventory-patch', { detail: { patch: { hand: removed.item } } })
    );

    try {
      const res = await fetch('/api/site-inventory/me', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'pickup', placedItemId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 401 (anonym) / 409 (Hand voll auf Server) / 404 (Item nicht mehr da)
        // → optimistischen Stand zurückrollen.
        setItems((prev) => [...prev, removed]);
        window.dispatchEvent(
          new CustomEvent('site-inventory-patch', { detail: { patch: { hand: null } } })
        );
        return;
      }
      // Bewusst KEIN site-inventory-update bei Erfolg: der optimistische
      // Patch ist bereits die UI-Wahrheit. Würden wir hier den Server-Stand
      // dispatchen, könnte eine verzögerte Pickup-Response nach einem
      // schnellen Drop das Inventar überschreiben (Race-Condition: User sieht
      // erst Hand leer, dann plötzlich wieder voll).
      void data;
    } catch (err) {
      console.warn('[site-placed-items] pickup error', err);
      setItems((prev) => [...prev, removed]);
      window.dispatchEvent(
        new CustomEvent('site-inventory-patch', { detail: { patch: { hand: null } } })
      );
    }
  }

  if (items.length === 0) return null;

  return (
    <>
      {items.map((it) => (
        <button
          key={`placed-${it.placedItemId}`}
          type="button"
          class="site-placed-item"
          style={{ left: `${it.x}px`, top: `${it.y}px` }}
          aria-label={`${it.item?.name || 'Item'} aufheben`}
          title={it.item?.name || ''}
          onPointerDown={(e) => onItemClick(it.placedItemId, e)}
        >
          <span aria-hidden="true">{iconForItem(it.item)}</span>
        </button>
      ))}
      <style>{`
        .site-placed-item {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 0;
          margin: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 1.6rem;
          line-height: 1;
          z-index: 396;
          transition: transform 0.15s ease;
        }
        .site-placed-item:hover,
        .site-placed-item:focus-visible {
          transform: translate(-50%, -55%);
          outline: none;
        }
      `}</style>
    </>
  );
}
