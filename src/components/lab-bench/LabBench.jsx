import { useState, useEffect, useRef } from 'preact/hooks';
import { ITEM_META, renderItem, LabBenchDefs } from './items.jsx';
import { dbg } from '../../lib/mikrobio-debug.js';

// Bio/Chemie-Labor-Szene. Reusable Engine: wir geben spaeter pro Experiment
// einen Config-Block rein (Inventar-Items + Snap-Regeln + Ziel-Setup). Aktuell
// haengen die Demo-Items fuer Pasteur direkt im Component — als Skelett.
//
// Engine-Verhalten (v1):
//   - Items in Inventar-Zonen (Regal hinten, Schublade unten, Versorgung rechts,
//     Kuehlschrank). Drag startet einen Clone — die Originale bleiben.
//   - Drop auf Tisch: freie Platzierung. In der Naehe eines Snap-Slots
//     (Stativ-Klemme akzeptiert Kolben): einrasten.
//   - Drop auf Muelleimer (links unten): Item geloescht. Inventar-Items wandern
//     dabei einfach zurueck (nichts passiert).
//   - Click auf platziertes Item (kurze Bewegung, kurze Zeit): Interaktion je
//     nach Typ. Bunsen toggelt an/aus (sichtbare Flamme); Kolben kippen.
//   - Kuehlschrank: Click oeffnet/schliesst Tuer (Inhalt nur sichtbar wenn offen).
//
// Mood-Smiley sitzt oben links und reagiert spaeter auf Spielregeln. Aktuell
// nur Display, kein Tracking — kommt mit der Game-Logik.

const SCENE_W = 1000;
// Etwas hoeher als 600, damit der Stativ (180 px hoch) komplett in die
// Schublade passt, ohne ueber die Tischkante zu kriechen.
const SCENE_H = 640;

const CLICK_THRESH_PX = 6;
const CLICK_THRESH_MS = 260;
const SNAP_RADIUS = 70;

const ZONES = {
  trash:      { x:  18, y: 510, w:  90, h: 100, label: 'Muelleimer' },
  shelf:      { x: 560, y:  60, w: 360, h: 230, label: 'Regal' },
  fridge:     { x:  60, y:  60, w: 160, h: 280, label: 'Kuehlschrank' },
  underTable: { x: 130, y: 425, w: 800, h: 195, label: 'Schublade' },
};

// Default-Inventar (wird genutzt wenn keine `inventory`-Prop kommt). Position
// (x,y) sind die Eckkoordinaten *in* der jeweiligen Zone, in SVG-Einheiten.
// Pro Experiment kann das via Prop ueberschrieben werden.
const DEFAULT_INVENTORY = [
  { type: 'bottle_sterile',    x: 600, y: 130 }, // Regal
  { type: 'bottle_unsterile',  x: 680, y: 130 },
  { type: 'bottle_sterile',    x: 760, y: 210 },
  { type: 'bottle_unsterile',  x: 840, y: 210 },

  { type: 'test_tube',         x: 250, y: 450 }, // Schublade
  { type: 'test_tube',         x: 282, y: 450 },
  { type: 'test_tube',         x: 314, y: 450 },
  { type: 'petri_dish',        x: 360, y: 520 },
  { type: 'flask_round',       x: 430, y: 450 },
  { type: 'flask_erlenmeyer',  x: 510, y: 450 },
  { type: 'flask_pasteur',     x: 600, y: 410 },
  { type: 'beaker',            x: 710, y: 470 },
  { type: 'tongs',             x: 770, y: 460 },

  { type: 'bunsen',            x: 880, y: 250 }, // Versorgung rechts
  { type: 'stand',             x: 880, y: 380, anchor: 'baseline' },
];

const DEFAULT_FRIDGE_INVENTORY = [
  // { type: 'bottle_xy', x: 110, y: 200 },
];

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export default function LabBench({
  inventory = DEFAULT_INVENTORY,
  fridgeInventory = DEFAULT_FRIDGE_INVENTORY,
  mood = 0,
  actionsForItem,
  onAction,
  onPlacedChange,
  onSourceDropped,  // (sourceType, targetItem|null, helpers) - Flaschen-auf-Kolben
} = {}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [placed, setPlaced] = useState([]);
  const [, forceRender] = useState(0);
  const [fridgeOpen, setFridgeOpen] = useState(false);
  // Menu state fuer Klick-auf-Item: { itemId, x, y, actions }
  const [menu, setMenu] = useState(null);
  // Tongs-Position pro Animations-Frame fuer Glas-Zieh-Effekt: { x, y } | null
  const [pulledOverlay, setPulledOverlay] = useState(null);

  // Parent ueber Aenderungen am Tisch informieren (z. B. fuer Snap-getriggerte
  // Progress-Events wie "Erlenmeyer auf Stativ").
  useEffect(() => {
    onPlacedChange?.(placed);
  }, [placed, onPlacedChange]);

  // Pointer-Position in SVG-Koordinaten
  function svgPoint(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SCENE_W,
      y: ((e.clientY - rect.top) / rect.height) * SCENE_H,
    };
  }

  // Drag-Loop laeuft ueber document, damit der Drag nicht abreisst wenn die
  // Maus kurz das SVG verlaesst.
  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return;
      const p = svgPoint(e);
      dragRef.current.cur = p;
      forceRender((n) => n + 1);
    }
    function onUp(e) {
      const d = dragRef.current;
      if (!d) return;
      const p = svgPoint(e);
      d.cur = p;
      finalizeDrop(d);
      dragRef.current = null;
      forceRender((n) => n + 1);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  function startDragFromInventory(e, inv) {
    e.stopPropagation();
    const p = svgPoint(e);
    dragRef.current = {
      itemType: inv.type,
      cloneFromInventory: true,
      offsetX: p.x - inv.x,
      offsetY: p.y - inv.y,
      start: { x: p.x, y: p.y },
      cur: { x: p.x, y: p.y },
      startTime: Date.now(),
    };
    forceRender((n) => n + 1);
  }

  function startDragPlaced(e, item) {
    e.stopPropagation();
    const p = svgPoint(e);
    dragRef.current = {
      itemType: item.type,
      originId: item.id,
      state: item.state || {},
      offsetX: p.x - item.x,
      offsetY: p.y - item.y,
      start: { x: p.x, y: p.y },
      cur: { x: p.x, y: p.y },
      startTime: Date.now(),
    };
    forceRender((n) => n + 1);
  }

  function finalizeDrop(d) {
    const dt = Date.now() - d.startTime;
    const dist = Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y);
    const isClick = dist < CLICK_THRESH_PX && dt < CLICK_THRESH_MS;
    dbg('drop', {
      type: d.itemType,
      cloneFromInventory: !!d.cloneFromInventory,
      originId: d.originId || null,
      cur: { x: Math.round(d.cur.x), y: Math.round(d.cur.y) },
      start: { x: Math.round(d.start.x), y: Math.round(d.start.y) },
      offset: { x: Math.round(d.offsetX), y: Math.round(d.offsetY) },
      dt,
      dist: Math.round(dist),
      isClick,
      placedCount: placed.length,
    });

    if (isClick && d.originId) {
      interactPlaced(d.originId);
      return;
    }
    if (isClick && d.cloneFromInventory) {
      dbg('drop-ignored-click-on-inventory', { type: d.itemType });
      return;
    }

    // Trash?
    if (pointInRect(d.cur.x, d.cur.y, ZONES.trash)) {
      dbg('drop-trash', { originId: d.originId || null });
      if (d.originId) {
        setPlaced((prev) => prev.filter((p) => p.id !== d.originId));
      }
      return;
    }

    const meta = ITEM_META[d.itemType];

    // Source-Items (Flaschen): nicht auf den Tisch legen, sondern Pour-Event
    // ausloesen, wenn das Drop ueber einem platzierten Item landet.
    // Source-Items (Flaschen): wenn ueber einem Vessel gedroppt -> Pour-Event,
    // Flasche wird NICHT platziert. Wenn woanders gedroppt -> faellt durch zur
    // normalen Platzierung wie jedes andere Item.
    if (meta.kind === 'source' && d.cloneFromInventory && onSourceDropped) {
      const checks = placed.map((p) => {
        const pm = ITEM_META[p.type];
        const hit =
          d.cur.x >= p.x &&
          d.cur.x <= p.x + pm.w &&
          d.cur.y >= p.y &&
          d.cur.y <= p.y + pm.h;
        return {
          id: p.id,
          type: p.type,
          kind: pm.kind || null,
          bbox: { x: Math.round(p.x), y: Math.round(p.y), w: pm.w, h: pm.h },
          hit,
        };
      });
      const hitVessels = placed.filter(
        (p, i) => checks[i].hit && ITEM_META[p.type].kind === 'vessel',
      );
      const target = hitVessels.length > 0 ? hitVessels[hitVessels.length - 1] : null;
      dbg('source-drop', {
        sourceType: d.itemType,
        cur: { x: Math.round(d.cur.x), y: Math.round(d.cur.y) },
        targetFound: !!target,
        targetId: target?.id || null,
        targetType: target?.type || null,
        candidates: checks,
        hasOnSourceDropped: typeof onSourceDropped === 'function',
      });
      if (target) {
        const helpers = {
          update: (partial) => updateItemState(target.id, partial),
          remove: () => removeItemById(target.id),
          changeType: (newType) => setItemTypeById(target.id, newType),
          placed,
        };
        onSourceDropped(d.itemType, target, helpers);
        return;
      }
      // Kein Vessel getroffen — Flasche wird normal abgestellt (faellt durch).
    }
    let dropX = d.cur.x - d.offsetX;
    let dropY = d.cur.y - d.offsetY;

    // Snap an Slots anderer platzierter Items
    const cx = dropX + meta.w / 2;
    const cy = dropY + meta.h / 2;
    let snapped = null;
    for (const other of placed) {
      if (other.id === d.originId) continue;
      const om = ITEM_META[other.type];
      if (!om.snapSlots) continue;
      for (const slot of om.snapSlots) {
        if (!slot.accepts?.includes(d.itemType)) continue;
        const sx = other.x + slot.x;
        const sy = other.y + slot.y;
        if (Math.hypot(cx - sx, cy - sy) < SNAP_RADIUS) {
          snapped = { x: sx - meta.w / 2, y: sy - meta.h / 2 };
          break;
        }
      }
      if (snapped) break;
    }
    if (snapped) {
      dropX = snapped.x;
      dropY = snapped.y;
    }

    // Drop auf Tisch (oder eigentlich ueberall im Szenenbereich)
    if (d.cloneFromInventory) {
      const id = `p${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setPlaced((prev) => [...prev, { id, type: d.itemType, x: dropX, y: dropY, state: {} }]);
    } else if (d.originId) {
      setPlaced((prev) => prev.map((p) => (p.id === d.originId ? { ...p, x: dropX, y: dropY } : p)));
    }
  }

  function interactPlaced(id) {
    const item = placed.find((p) => p.id === id);
    if (!item) return;
    if (actionsForItem) {
      const actions = actionsForItem(item, placed);
      if (actions && actions.length > 0) {
        const meta = ITEM_META[item.type];
        setMenu({
          itemId: id,
          x: item.x + meta.w + 8,
          y: item.y,
          actions,
        });
        return;
      }
    }
    // Fallback ohne actionsForItem-Prop: alte Toggle-/Rotate-Logik.
    const meta = ITEM_META[item.type];
    if (meta.interaction === 'toggle') {
      updateItemState(id, { on: !item.state?.on });
    } else if (meta.interaction === 'rotate') {
      updateItemState(id, { tilted: !item.state?.tilted });
    }
  }

  function updateItemState(id, partial) {
    dbg('item-update', { id, partial });
    setPlaced((prev) =>
      prev.map((p) => (p.id === id ? { ...p, state: { ...(p.state || {}), ...partial } } : p)),
    );
  }

  function removeItemById(id) {
    dbg('item-remove', { id });
    setPlaced((prev) => prev.filter((p) => p.id !== id));
  }

  function setItemTypeById(id, newType) {
    dbg('item-changetype', { id, newType });
    setPlaced((prev) => prev.map((p) => (p.id === id ? { ...p, type: newType } : p)));
  }

  function addItemAt(type, x, y, state = {}) {
    const id = `p${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    dbg('item-add', { id, type, x: Math.round(x), y: Math.round(y), state });
    setPlaced((prev) => [...prev, { id, type, x, y, state }]);
    return id;
  }

  function findPlaced(predicate) {
    return placed.find(predicate) || null;
  }

  function handleActionClick(actionId) {
    if (!menu) return;
    const item = placed.find((p) => p.id === menu.itemId);
    setMenu(null);
    if (!item) return;
    const helpers = {
      update: (partial) => updateItemState(item.id, partial),
      remove: () => removeItemById(item.id),
      changeType: (newType) => setItemTypeById(item.id, newType),
      addAt: (type, x, y, state) => addItemAt(type, x, y, state),
      findPlaced,
      placed,
      runPullAnimation: (overlay, durationMs = 1400) => {
        setPulledOverlay(overlay);
        setTimeout(() => setPulledOverlay(null), durationMs);
      },
    };
    onAction?.(actionId, item, helpers);
  }

  // Klick irgendwo ausserhalb des Menus schliesst es.
  useEffect(() => {
    if (!menu) return undefined;
    function onDocDown(e) {
      // Wir feuern das Schliessen, sobald der naechste pointerdown ausserhalb
      // eines `.lb-menu`-Knotens kommt. Der Klick auf einen Menu-Button selbst
      // triggert handleActionClick, das setMenu(null) eh aufruft.
      const target = e.target;
      if (target && target.closest?.('.lb-menu')) return;
      setMenu(null);
    }
    document.addEventListener('pointerdown', onDocDown, true);
    return () => document.removeEventListener('pointerdown', onDocDown, true);
  }, [menu]);

  const drag = dragRef.current;

  return (
    <div className="lb-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        className="lb-svg"
      >
        <LabBenchDefs />

        {/* Wand-Hintergrund */}
        <rect x="0" y="0" width={SCENE_W} height={SCENE_H} fill="url(#lb-wall)" />

        {/* Boden */}
        <rect x="0" y="620" width={SCENE_W} height="20" fill="#7a6648" />
        <line x1="0" y1="620" x2={SCENE_W} y2="620" stroke="#4a3920" stroke-width="2" />

        {/* Regal hinten */}
        <SceneShelf zone={ZONES.shelf} />

        {/* Kuehlschrank */}
        <SceneFridge
          zone={ZONES.fridge}
          open={fridgeOpen}
          onClick={() => setFridgeOpen((o) => !o)}
        />

        {/* Tisch */}
        <rect x="0" y="380" width={SCENE_W} height="44" fill="url(#lb-table)" />
        <rect x="0" y="424" width={SCENE_W} height="6" fill="#5d4a30" />
        <line x1="0" y1="380" x2={SCENE_W} y2="380" stroke="#5d4a30" stroke-width="1.5" />

        {/* Schublade unter dem Tisch (Inventar) */}
        <rect
          x={ZONES.underTable.x}
          y={ZONES.underTable.y}
          width={ZONES.underTable.w}
          height={ZONES.underTable.h}
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(0,0,0,0.18)"
          stroke-width="1.5"
          stroke-dasharray="6 4"
          rx="6"
        />
        <text
          x={ZONES.underTable.x + 10}
          y={ZONES.underTable.y + 16}
          font-size="10"
          font-weight="700"
          letter-spacing="0.08em"
          fill="rgba(0,0,0,0.45)"
          font-family="ui-sans-serif, system-ui, sans-serif"
        >
          SCHUBLADE
        </text>

        {/* Muelleimer */}
        <SceneTrash zone={ZONES.trash} />

        {/* Inventar-Items in den Zonen */}
        {inventory.map((inv, idx) => (
          <g
            key={`inv-${inv.type}-${idx}`}
            transform={`translate(${inv.x},${inv.y})`}
            onPointerDown={(e) => startDragFromInventory(e, inv)}
            style={{ cursor: 'grab' }}
          >
            {renderItem(inv.type, {})}
            <title>{ITEM_META[inv.type].label} — ziehen zum Tisch</title>
          </g>
        ))}

        {/* Kuehlschrank-Inhalt (nur sichtbar wenn offen) */}
        {fridgeOpen &&
          fridgeInventory.map((inv, idx) => (
            <g
              key={`fridge-${inv.type}-${idx}`}
              transform={`translate(${inv.x},${inv.y})`}
              onPointerDown={(e) => startDragFromInventory(e, inv)}
              style={{ cursor: 'grab' }}
            >
              {renderItem(inv.type, {})}
            </g>
          ))}

        {/* Platzierte Items */}
        {placed.map((item) => {
          const meta = ITEM_META[item.type];
          const isDragging = drag && drag.originId === item.id;
          if (isDragging) return null;
          const cx = meta.w / 2;
          const cy = meta.h / 2;
          const transform =
            `translate(${item.x},${item.y})` +
            (item.state?.tilted ? ` rotate(38 ${cx} ${cy})` : '');
          return (
            <g
              key={item.id}
              transform={transform}
              onPointerDown={(e) => startDragPlaced(e, item)}
              style={{ cursor: 'grab' }}
            >
              {renderItem(item.type, item.state)}
              <title>{meta.label}{meta.interaction ? ` — Klick: ${meta.interaction === 'toggle' ? 'an/aus' : meta.interaction === 'rotate' ? 'kippen' : meta.interaction}` : ''}</title>
            </g>
          );
        })}

        {/* Drag-Ghost */}
        {drag && (() => {
          const m = ITEM_META[drag.itemType];
          const gx = drag.cur.x - drag.offsetX;
          const gy = drag.cur.y - drag.offsetY;
          // Snap-Vorschau: pruefen ob naher Snap-Slot existiert
          const cx = gx + m.w / 2;
          const cy = gy + m.h / 2;
          let snapTo = null;
          for (const other of placed) {
            if (other.id === drag.originId) continue;
            const om = ITEM_META[other.type];
            if (!om.snapSlots) continue;
            for (const slot of om.snapSlots) {
              if (!slot.accepts?.includes(drag.itemType)) continue;
              const sx = other.x + slot.x;
              const sy = other.y + slot.y;
              if (Math.hypot(cx - sx, cy - sy) < SNAP_RADIUS) {
                snapTo = { x: sx, y: sy };
                break;
              }
            }
            if (snapTo) break;
          }
          return (
            <g style={{ pointerEvents: 'none' }}>
              {snapTo && (
                <circle
                  cx={snapTo.x}
                  cy={snapTo.y}
                  r={SNAP_RADIUS - 8}
                  fill="rgba(106, 140, 175, 0.18)"
                  stroke="#6a8caf"
                  stroke-width="2"
                  stroke-dasharray="4 3"
                />
              )}
              <g
                transform={`translate(${gx},${gy})`}
                opacity="0.92"
                style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))' }}
              >
                {renderItem(drag.itemType, drag.state || {})}
              </g>
            </g>
          );
        })()}

        {/* Glas-Zieh-Overlay: temporaer Tongs + Bunsen-Drift fuer
            Pull-Animation. Wird via helpers.runPullAnimation gesetzt. */}
        {pulledOverlay && (
          <g className="lb-pull-overlay" style={{ pointerEvents: 'none' }}>
            {pulledOverlay.bunsen && (
              <g transform={`translate(${pulledOverlay.bunsen.x},${pulledOverlay.bunsen.y})`}>
                {renderItem('bunsen', { on: true })}
              </g>
            )}
            {pulledOverlay.tongs && (
              <g transform={`translate(${pulledOverlay.tongs.x},${pulledOverlay.tongs.y})`}>
                {renderItem('tongs', {})}
              </g>
            )}
          </g>
        )}

        {/* Aktion-Menue */}
        {menu && (() => {
          const w = 220;
          const rowH = 30;
          const h = menu.actions.length * rowH + 16;
          const x = Math.max(8, Math.min(menu.x, SCENE_W - w - 8));
          const y = Math.max(8, Math.min(menu.y, SCENE_H - h - 8));
          return (
            <g className="lb-menu" transform={`translate(${x},${y})`}>
              <rect
                x="0"
                y="0"
                width={w}
                height={h}
                fill="#ffffff"
                stroke="#3a3a3a"
                stroke-width="1.4"
                rx="6"
                style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}
              />
              {menu.actions.map((a, i) => (
                <g
                  key={a.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleActionClick(a.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x="4"
                    y={8 + i * rowH}
                    width={w - 8}
                    height={rowH - 4}
                    rx="3"
                    fill="rgba(106, 140, 175, 0.08)"
                  />
                  <text
                    x="12"
                    y={8 + i * rowH + rowH / 2 + 4}
                    font-size="13"
                    fill="#1a1a1a"
                    font-family="ui-sans-serif, system-ui, sans-serif"
                  >
                    {a.label}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* Mood-Smiley oben links */}
        <MoodSmiley mood={mood} x={20} y={18} />
      </svg>
      <Styles />
    </div>
  );
}

function SceneShelf({ zone }) {
  return (
    <g>
      {/* Rueckwand vom Regal (dunkler) */}
      <rect x={zone.x - 4} y={zone.y - 4} width={zone.w + 8} height={zone.h + 8} fill="#7a6648" rx="3" />
      {/* Innenraum */}
      <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} fill="#b89c70" />
      {/* Bretter */}
      <line x1={zone.x} y1={zone.y + zone.h / 2} x2={zone.x + zone.w} y2={zone.y + zone.h / 2} stroke="#5d4a30" stroke-width="4" />
      <line x1={zone.x} y1={zone.y + zone.h} x2={zone.x + zone.w} y2={zone.y + zone.h} stroke="#5d4a30" stroke-width="4" />
      {/* Hellerer Streifen oben (Schatten) */}
      <rect x={zone.x} y={zone.y} width={zone.w} height="8" fill="rgba(0,0,0,0.18)" />
      <rect x={zone.x} y={zone.y + zone.h / 2 + 4} width={zone.w} height="8" fill="rgba(0,0,0,0.18)" />
    </g>
  );
}

function SceneFridge({ zone, open, onClick }) {
  return (
    <g style={{ cursor: 'pointer' }} onPointerUp={(e) => { e.stopPropagation(); onClick?.(); }}>
      {/* Korpus */}
      <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="6" fill="url(#lb-fridge)" stroke="#7a8590" stroke-width="2" />
      {/* Frostfach-Trennung */}
      <line x1={zone.x} y1={zone.y + 70} x2={zone.x + zone.w} y2={zone.y + 70} stroke="#7a8590" stroke-width="1.5" />
      {open ? (
        <>
          {/* offene Tuer auf der linken Seite, leicht aufgeschwungen */}
          <g transform={`translate(${zone.x - 90} ${zone.y + 15}) rotate(-22)`} style={{ transformOrigin: 'right top' }}>
            <rect x="0" y="0" width={zone.w * 0.55} height={zone.h - 20} fill="#f4f7fa" stroke="#7a8590" stroke-width="1.5" rx="3" />
            <rect x="6" y="6" width={zone.w * 0.55 - 12} height={zone.h - 32} fill="rgba(0,0,0,0.06)" />
          </g>
          {/* Innenraum */}
          <rect x={zone.x + 6} y={zone.y + 76} width={zone.w - 12} height={zone.h - 82} fill="#dbe7ef" />
          <line x1={zone.x + 6} y1={zone.y + 140} x2={zone.x + zone.w - 6} y2={zone.y + 140} stroke="#9eb2c0" stroke-width="2" />
          <line x1={zone.x + 6} y1={zone.y + 210} x2={zone.x + zone.w - 6} y2={zone.y + 210} stroke="#9eb2c0" stroke-width="2" />
        </>
      ) : (
        <>
          {/* Tuer geschlossen */}
          <line x1={zone.x + 8} y1={zone.y + 4} x2={zone.x + 8} y2={zone.y + zone.h - 4} stroke="#7a8590" stroke-width="1.5" />
          <line x1={zone.x + zone.w - 8} y1={zone.y + 4} x2={zone.x + zone.w - 8} y2={zone.y + zone.h - 4} stroke="#7a8590" stroke-width="1.5" />
          {/* Griff */}
          <rect x={zone.x + zone.w - 18} y={zone.y + 90} width="6" height="60" fill="#9eb2c0" stroke="#5a6a76" stroke-width="1" rx="2" />
          <rect x={zone.x + zone.w - 18} y={zone.y + 16} width="6" height="36" fill="#9eb2c0" stroke="#5a6a76" stroke-width="1" rx="2" />
          {/* Label */}
          <text x={zone.x + zone.w / 2} y={zone.y + zone.h / 2 + 6} text-anchor="middle" font-size="10" fill="#5a6a76" font-weight="700" font-family="ui-sans-serif, system-ui, sans-serif">
            KUEHLSCHRANK
          </text>
          <text x={zone.x + zone.w / 2} y={zone.y + zone.h / 2 + 22} text-anchor="middle" font-size="8" fill="#7a8590" font-family="ui-sans-serif, system-ui, sans-serif">
            klick zum oeffnen
          </text>
        </>
      )}
    </g>
  );
}

function SceneTrash({ zone }) {
  const cx = zone.x + zone.w / 2;
  return (
    <g>
      {/* Korpus (leicht konisch) */}
      <path
        d={`M${zone.x + 8} ${zone.y + 22}
            L${zone.x + zone.w - 8} ${zone.y + 22}
            L${zone.x + zone.w - 14} ${zone.y + zone.h - 6}
            L${zone.x + 14} ${zone.y + zone.h - 6} Z`}
        fill="#7a8a96"
        stroke="#3f4a55"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      {/* Vertikale Riefen */}
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={zone.x + 16 + i * ((zone.w - 32) / 3)}
          y1={zone.y + 28}
          x2={zone.x + 18 + i * ((zone.w - 32) / 3)}
          y2={zone.y + zone.h - 12}
          stroke="#3f4a55"
          stroke-width="0.8"
          opacity="0.55"
        />
      ))}
      {/* Deckel */}
      <ellipse cx={cx} cy={zone.y + 22} rx={zone.w / 2 - 6} ry="6" fill="#9aa9b5" stroke="#3f4a55" stroke-width="1.4" />
      <ellipse cx={cx} cy={zone.y + 18} rx={zone.w / 2 - 4} ry="4" fill="#aebac4" stroke="#3f4a55" stroke-width="1.2" />
      {/* Klappgriff */}
      <rect x={cx - 8} y={zone.y + 10} width="16" height="6" rx="2" fill="#3f4a55" />
      {/* Label */}
      <text x={cx} y={zone.y + zone.h + 12} text-anchor="middle" font-size="9" font-weight="700" fill="rgba(0,0,0,0.55)" font-family="ui-sans-serif, system-ui, sans-serif">
        MUELLEIMER
      </text>
    </g>
  );
}

function MoodSmiley({ mood, x, y }) {
  // mood: -3..+3, 0 = neutral
  const m = Math.max(-3, Math.min(3, mood || 0));
  const happy = m / 3; // -1..+1
  const mouthYBase = 36;
  // happy=+1 -> Kontrollpunkt UNTER den Endpunkten (groesseres y in SVG
  // = visuell tiefer) -> Mund kruemmt sich runter = SMILE.
  // happy=-1 -> Kontrollpunkt OBER  -> Mund nach oben gekruemmt = FROWN.
  const mouthCtrlY = mouthYBase + happy * 8;
  const pathD = `M 16 ${mouthYBase} Q 26 ${mouthCtrlY} 36 ${mouthYBase}`;
  // Render-Log fuer Bug-Hunt: was der Browser tatsaechlich gezeichnet bekommt.
  if (typeof window !== 'undefined') {
    dbg('mood-smiley-render', {
      mood,
      happy,
      mouthYBase,
      mouthCtrlY,
      pathD,
      controlIsBelow: mouthCtrlY > mouthYBase,
      expects: happy > 0 ? 'smile' : happy < 0 ? 'frown' : 'flat',
    });
  }
  // Augenform: happy = halbmond, sad = kleine Punkte
  const colorBg = happy >= 0.3 ? '#cfeed6' : happy <= -0.3 ? '#f3d5d5' : '#e7ecf0';
  const colorRing = happy >= 0.3 ? '#3a8754' : happy <= -0.3 ? '#a23a3a' : '#5a6a76';
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="26" cy="26" r="24" fill={colorBg} stroke={colorRing} stroke-width="2.5" />
      {/* Augen */}
      <circle cx="18" cy="22" r="2.6" fill="#2a2a2a" />
      <circle cx="34" cy="22" r="2.6" fill="#2a2a2a" />
      {/* Mund */}
      <path
        d={pathD}
        fill="none"
        stroke="#2a2a2a"
        stroke-width="2.4"
        stroke-linecap="round"
      />
    </g>
  );
}

function Styles() {
  return (
    <style>{`
      .lb-wrap {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
      }
      .lb-svg {
        width: 100%;
        height: auto;
        display: block;
        touch-action: none;
        user-select: none;
        border-radius: 0.8rem;
        background: #d8e1e8;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
      }
      .lb-svg :where(g, rect, path, circle, ellipse) {
        -webkit-user-select: none;
        user-select: none;
      }
      .lb-flame {
        animation: lb-flame-flicker 0.65s ease-in-out infinite alternate;
        transform-origin: 35px 38px;
      }
      @keyframes lb-flame-flicker {
        0%   { transform: scale(1) translateY(0); }
        100% { transform: scale(1.04, 1.08) translateY(-1px); }
      }
    `}</style>
  );
}
