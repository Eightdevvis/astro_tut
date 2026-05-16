import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import LabBench from '../LabBench.jsx';
import { ITEM_META, LIQUID_COLOR_UNSTERILE, LIQUID_COLOR_STERILE } from '../items.jsx';
import MikrobioDebugPanel from '../../MikrobioDebugPanel.jsx';
import { dbg } from '../../../lib/mikrobio-debug.js';

// Pasteur-Experiment-Wrapper:
//   1. Intro-Szene: Pasteur-Portrait + Gedanken-Blase + Weiter-Knopf.
//   2. Lab-Phase: LabBench mit Pasteur-spezifischen Aktionen + Progress-
//      Tracking. Smiley faellt eine Stufe nach 3 Aktionen ohne Fortschritt.
//
// Progress-Events (jeder einmalig +1 Punkt):
//   flask_on_stand:    Erlenmeyer aufs Stativ gestellt (Snap erkannt).
//   liquid_in_flask:   Fluessigkeit (sterile od. unsterile) eingefuellt.
//   bunsen_below:      Bunsen unter den Kolben.
//   sterilized:        Bunsen an + drunter + Fluessigkeit drin.
//   bunsen_at_neck:    Bunsen an den Hals gehalten (Vorbereitung Glaszug).
//   neck_pulled:       Hals zum Schwanenhals gezogen (mit Zange).
//   tipped:            Kolben gekippt (kontaminiert dann je nach Setup).
//
// Per `?skip=1` springt die Intro fuer Debugging weg.

const PROGRESS_TARGETS = [
  'flask_on_stand',
  'liquid_in_flask',
  'bunsen_below',
  'sterilized',
  'bunsen_at_neck',
  'neck_pulled',
  'tipped',
];

export default function Pasteur({ skipIntro = false }) {
  const [phase, setPhase] = useState(skipIntro ? 'lab' : 'intro');

  useEffect(() => {
    if (phase === 'lab' && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [phase]);

  if (phase === 'intro') {
    return <Intro onContinue={() => setPhase('lab')} />;
  }
  return <Lab />;
}

function Lab() {
  // Set der bereits erreichten Meilensteine.
  const [progress, setProgress] = useState(() => new Set());
  // Synchroner Spiegel des progress-Sets — wird in `award()` benutzt um
  // Prerequisite-Checks zu fahren, ohne auf den naechsten Render zu warten
  // (setProgress ist async, mehrere Awards in derselben Aktion wuerden sonst
  // alle vom gleichen alten progress-Snapshot ausgehen).
  const progressRef = useRef(new Set());
  // Zaehler an Aktionen seit dem letzten Progress-Event.
  const [idleActions, setIdleActions] = useState(0);
  // Wird gesetzt von LabBench, wenn `flask_on_stand` getriggert wurde.
  const placedReportRef = useRef({});
  // Kurzer Lehr-Hinweis. Wird beim Falschmachen gesetzt; verschwindet nach
  // ein paar Sekunden. Beispiel: "Mit steriler Bruehe lernst du nichts ueber
  // Sterilisation — Pasteur startet mit unsteriler".
  const [hint, setHint] = useState(null);
  const hintTimerRef = useRef(null);
  // Spilled-State: wenn der Kolben ohne Schwanenhals gekippt wurde, schwappt
  // die Bruehe raus — Smiley sofort sehr schlecht gelaunt, bis User die
  // Puddle in den Muelleimer zieht.
  const [spilled, setSpilled] = useState(false);
  function showHint(text, ms = 5000) {
    setHint(text);
    clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), ms);
  }
  useEffect(() => () => clearTimeout(hintTimerRef.current), []);

  // Mood: spilled ueberschreibt alles (Bruehe ausgekippt = sehr schlecht).
  const mood = spilled ? -3 : computeMood(idleActions);
  // Mood-Tracking ins Debug-Log: bei jedem Render zeigen wir den aktuellen
  // Idle-Counter, den daraus berechneten Mood-Wert (-3..+3) und den daraus
  // resultierenden Smiley-Mund-Kontrollpunkt. Damit kannst du im Panel sehen,
  // ob die Skala richtig kippt.
  useEffect(() => {
    const happy = Math.max(-1, Math.min(1, mood / 3));
    dbg('mood', {
      idleActions,
      mood,
      happy: Number(happy.toFixed(2)),
      mouthCtrlY: 36 + happy * 8,
      // Erwartet: happy=+1 -> mouthCtrlY=44 (unter Endpunkten=36) -> LAECHELN.
      //           happy=-1 -> mouthCtrlY=28 (ueber Endpunkten)   -> FROWN.
      expects: happy > 0 ? 'smile' : happy < 0 ? 'frown' : 'flat',
    });
  }, [mood, idleActions]);

  function award(event) {
    const idx = PROGRESS_TARGETS.indexOf(event);
    // Prerequisite-Check: jeder Meilenstein braucht den vorherigen.
    // Erster Meilenstein (idx=0) hat keinen Vorgaenger.
    if (idx > 0) {
      const prev = PROGRESS_TARGETS[idx - 1];
      if (!progressRef.current.has(prev)) {
        dbg('award-blocked-out-of-order', { event, requires: prev });
        showHint(
          `Reihenfolge: "${labelForEvent(prev)}" muss erst sitzen, bevor "${labelForEvent(event)}" zaehlt.`,
        );
        bump();
        return;
      }
    }
    if (progressRef.current.has(event)) return; // schon erreicht
    const next = new Set(progressRef.current);
    next.add(event);
    progressRef.current = next;
    setProgress(next);
    setIdleActions(0);
    dbg('award-ok', { event, total: next.size });
  }

  function bump() {
    setIdleActions((n) => n + 1);
  }

  // Inventar fuer Pasteur. Flaschen im Regal (Source-Items, drag-to-pour),
  // alles andere in der Schublade. Items "stehen" mit ihrer Unterkante
  // ungefaehr auf y=615 (Schubladen-Boden).
  const inventory = useMemo(
    () => [
      // Regal: Flaschen. Sterile + unsterile sind beide da — User soll
      // selber rausfinden was Sinn macht. Sterile geben aber keinen
      // Meilenstein und triggern einen Hint + Idle-Bump (Mood-Drop).
      { type: 'bottle_sterile',    x: 600, y: 130 },
      { type: 'bottle_unsterile',  x: 700, y: 130 },
      { type: 'bottle_sterile',    x: 780, y: 210 },
      { type: 'bottle_unsterile',  x: 870, y: 210 },

      // Schublade — fuer Pasteurs Experiment relevant ist nur der Erlenmeyer.
      // Den Schwanenhalskolben sollst du selbst herstellen (durch Heizen +
      // Glas-Ziehen). Andere Kolben-Typen liegen nicht rum, damit man nicht
      // versehentlich den Sinn umgeht.
      { type: 'stand',             x: 180, y: 435 },  // 110x180
      { type: 'bunsen',            x: 330, y: 495 },  // 70x120
      { type: 'flask_erlenmeyer',  x: 440, y: 515 },  // 70x100
      { type: 'beaker',            x: 530, y: 535 },  // 60x80
      { type: 'tongs',             x: 610, y: 525 },  // 40x90
      { type: 'test_tube',         x: 670, y: 525 },
      { type: 'test_tube',         x: 702, y: 525 },
      { type: 'petri_dish',        x: 740, y: 595 },  // 60x20
    ],
    [],
  );

  // Hilfsfunktionen, die auf `placed`-Snapshots aus dem LabBench operieren.
  // Werden in actionsForItem benutzt.
  function isOnStand(flask, placed) {
    return placed.some(
      (p) =>
        p.type === 'stand' &&
        Math.abs((p.x + ITEM_META.stand.snapSlots[0].x) - (flask.x + ITEM_META[flask.type].w / 2)) < 50 &&
        Math.abs((p.y + ITEM_META.stand.snapSlots[0].y) - (flask.y + ITEM_META[flask.type].h / 2)) < 50,
    );
  }
  function hasPlacedTongs(placed) {
    return placed.some((p) => p.type === 'tongs');
  }

  // Aktionen je nach Item-Typ + State + Nachbarn.
  function actionsForItem(item, placed) {
    let list = null;
    if (item.type === 'flask_erlenmeyer') {
      const s = item.state || {};
      const onStand = isOnStand(item, placed);
      list = [];
      if (!onStand) {
        list.push({ id: 'note_off_stand', label: '↪ Erst auf das Stativ stellen' });
      } else {
        if (!s.liquid) {
          list.push({ id: 'fill_unsterile', label: 'Unsterile Fluessigkeit einfuellen' });
          list.push({ id: 'fill_sterile',   label: 'Sterile Fluessigkeit einfuellen' });
        }
        // Bunsen + Zange via Drag-Snap. Sterilisation + Glas-Ziehen laufen
        // automatisch sobald die Bedingungen stimmen (siehe onPlacedChange).
        if (!s.bunsenBelow && !s.bunsenAtNeck && !s.sterilized)
          list.push({ id: 'note_drag_bunsen', label: '↪ Bunsenbrenner an den Kolben ziehen (drunter zum Sterilisieren)' });
        if (s.bunsenBelow && !s.sterilized && !s.sterilizing && !(s.liquid))
          list.push({ id: 'note_need_liquid', label: '↪ Erst Fluessigkeit einfuellen' });
        if (s.bunsenBelow && s.liquid && !s.sterilized && !s.sterilizing)
          list.push({ id: 'note_light_bunsen', label: '↪ Bunsen anzuenden (Klick auf den Brenner)' });
        if (s.sterilizing)
          list.push({ id: 'note_sterilizing', label: '↪ Sterilisiert gerade…' });
        if (s.sterilized && !s.bunsenAtNeck && s.neck !== 'swan')
          list.push({ id: 'note_drag_bunsen_neck', label: '↪ Bunsen an den Hals ziehen (Schwanenhals vorbereiten)' });
        if (s.bunsenAtNeck && !s.tongsAtNeck && s.neck !== 'swan')
          list.push({ id: 'note_need_tongs', label: '↪ Zange an den Hals ziehen (linke Seite)' });
        if (s.bunsenAtNeck && s.tongsAtNeck && s.neck !== 'swan' &&
            !placed.some((p) => p.type === 'bunsen' && p.state?.on))
          list.push({ id: 'note_light_bunsen_neck', label: '↪ Bunsen anzuenden zum Glas ziehen' });
        if (s.liquid && !s.tilted)
          list.push({ id: 'tip', label: 'Flasche kippen' });
        if (s.tilted)
          list.push({ id: 'untip', label: 'Wieder aufrichten' });
      }
    } else if (item.type === 'bunsen') {
      list = [{ id: 'toggle_on', label: item.state?.on ? 'Ausmachen' : 'Anzuenden' }];
    }
    dbg('actions-for', {
      itemType: item.type,
      itemId: item.id,
      state: item.state || null,
      offered: list?.map((a) => a.id) || null,
    });
    return list;
  }

  function handleAction(actionId, item, helpers) {
    switch (actionId) {
      case 'fill_unsterile':
        helpers.update({ liquid: 'unsterile', liquidColor: LIQUID_COLOR_UNSTERILE });
        award('liquid_in_flask');
        return;
      case 'fill_sterile':
        // Dieselbe Logik wie der sterile-pour-Drop: kein Meilenstein, Hint,
        // Mood-Drop. Sterile via Menue ist genauso ein Shortcut wie via
        // Drag.
        helpers.update({
          liquid: 'sterile',
          liquidColor: LIQUID_COLOR_STERILE,
          sterilized: true,
          cheated: true,
        });
        showHint(
          'Mit steriler Bruehe lernst du nichts ueber Sterilisation — Pasteur startet immer mit *unsteriler* Bruehe.',
        );
        bump();
        return;
      // Sterilisation + Glas-Ziehen passieren jetzt automatisch in
      // onPlacedChange, sobald die Snap-Konditionen + Bunsen-an stimmen.
      // Hier kein Menue-Pfad mehr.
      // pull_neck als Menue-Aktion ebenfalls entfernt — siehe onPlacedChange.
      case 'tip': {
        // Kippen-Regeln (umstrukturiert nach Sasha-Feedback):
        //   - Gerader Hals + Liquid drin -> Bruehe schwappt raus, Puddle
        //     erscheint daneben, Kolben leer, spilled=true -> Smiley sehr
        //     schlecht. Steril/unsteril egal — Hals-Form ist das Problem.
        //   - Schwanenhals -> Bruehe bleibt drin (Hals haelt sie zurueck);
        //     bleibt steril wenn vorher sterilisiert, sonst eh schon braun.
        //   - Empty -> nichts passiert ausser Animation + Meilenstein.
        const s = item.state || {};
        helpers.update({ tipped: true, tilted: true });
        award('tipped');
        if (s.liquid && s.neck !== 'swan') {
          // SPILL. Farbe vom aktuellen Liquid uebernehmen (steril hell oder
          // unsteril braun) — wird der Lache zugewiesen.
          const spilledColor = s.liquidColor || LIQUID_COLOR_UNSTERILE;
          // Puddle weiter nach links und tiefer, damit sie nicht wie ein
          // Deckel auf dem Bunsen unter dem Kolben sitzt. Bunsen ist 70 px
          // breit und sitzt mittig unter dem Kolben — links vorbei.
          const puddleX = item.x - 80;
          const puddleY = item.y + ITEM_META[item.type].h + 70;
          setTimeout(() => {
            helpers.addAt('puddle', puddleX, puddleY, { color: spilledColor });
            // Flasche leeren + Sterilisations-Status zurueck (man muesste
            // ja eh neu sterilisieren).
            helpers.update({
              liquid: null,
              liquidColor: null,
              sterilized: false,
              neckContaminated: false,
            });
            setSpilled(true);
            showHint(
              'Ohne Schwanenhals laeuft die Bruehe einfach aus dem geraden Hals raus! Sauber machen: Puddle in den Muelleimer ziehen.',
              7000,
            );
          }, 700);
        }
        return;
      }
      case 'untip':
        helpers.update({ tilted: false });
        bump();
        return;
      // clear_actions: Bunsen/Zange kann der User per Drag wegziehen,
      // separater Menue-Eintrag nicht mehr noetig. (Trash oder neuer Snap)
      case 'toggle_on':
        helpers.update({ on: !item.state?.on });
        bump();
        return;
      default:
        bump();
        return;
    }
  }

  // Position-basierte Snap-Erkennung: was sitzt aktuell wirklich in welchem
  // Flask-Slot? Liefert {bunsenBelow, bunsenAtNeck, tongsAtNeck} + die
  // jeweiligen Items.
  function detectFlaskSnaps(flask, placedItems) {
    const slots = ITEM_META.flask_erlenmeyer.snapSlots || [];
    const RADIUS = 70;
    const result = {
      bunsenBelow: null,
      bunsenAtNeck: null,
      tongsAtNeck: null,
    };
    for (const slot of slots) {
      const sx = flask.x + slot.x;
      const sy = flask.y + slot.y;
      const occ = placedItems.find((other) => {
        if (other.id === flask.id) return false;
        if (!slot.accepts.includes(other.type)) return false;
        const om = ITEM_META[other.type];
        const ocx = other.x + om.w / 2;
        const ocy = other.y + om.h / 2;
        return Math.hypot(ocx - sx, ocy - sy) < RADIUS;
      });
      if (!occ) continue;
      if (slot.id === 'below') result.bunsenBelow = occ;
      else if (slot.id === 'neck_heat') result.bunsenAtNeck = occ;
      else if (slot.id === 'neck_pull') result.tongsAtNeck = occ;
    }
    return result;
  }

  // Ref-Tracker: verhindert Doppel-Ausloesungen von Auto-Aktionen, weil
  // onPlacedChange mehrfach feuert bevor setPlaced den State commited hat.
  const autoSterilizingRef = useRef(new Set());
  const autoPullingRef = useRef(new Set());

  function onPlacedChange(placedItems, helpers) {
    placedReportRef.current.placed = placedItems;

    // Erlenmeyer auf Stativ?
    const flaskOnStand = placedItems.some(
      (p) => p.type === 'flask_erlenmeyer' && isOnStand(p, placedItems),
    );
    if (flaskOnStand && !progressRef.current.has('flask_on_stand')) {
      award('flask_on_stand');
    }

    // Pro Erlenmeyer: Snap-Flags abgleichen + Auto-Aktionen pruefen.
    for (const flask of placedItems) {
      if (flask.type !== 'flask_erlenmeyer') continue;
      const snaps = detectFlaskSnaps(flask, placedItems);
      const s = flask.state || {};

      // Flag-Sync: aktualisieren wenn sich die Realitaet vs. State unterscheiden.
      const flagUpdate = {};
      if (Boolean(snaps.bunsenBelow)  !== !!s.bunsenBelow)  flagUpdate.bunsenBelow  = !!snaps.bunsenBelow;
      if (Boolean(snaps.bunsenAtNeck) !== !!s.bunsenAtNeck) flagUpdate.bunsenAtNeck = !!snaps.bunsenAtNeck;
      if (Boolean(snaps.tongsAtNeck)  !== !!s.tongsAtNeck)  flagUpdate.tongsAtNeck  = !!snaps.tongsAtNeck;
      if (Object.keys(flagUpdate).length > 0) {
        helpers.update(flask.id, flagUpdate);
      }
      const effective = { ...s, ...flagUpdate };

      // Auto-Sterilisation: Bunsen unter dem Kolben + an + Liquid drin +
      // nicht schon sterilisiert / sterilisierend
      if (
        effective.bunsenBelow &&
        snaps.bunsenBelow?.state?.on &&
        effective.liquid &&
        !effective.sterilized &&
        !effective.sterilizing &&
        !autoSterilizingRef.current.has(flask.id)
      ) {
        autoSterilizingRef.current.add(flask.id);
        dbg('auto-sterilize-start', { flaskId: flask.id });
        helpers.update(flask.id, { sterilizing: true });
        setTimeout(() => {
          autoSterilizingRef.current.delete(flask.id);
          helpers.update(flask.id, {
            sterilizing: false,
            sterilized: true,
            liquidColor: LIQUID_COLOR_STERILE,
            neckContaminated: true,
          });
          award('sterilized');
          dbg('auto-sterilize-done', { flaskId: flask.id });
        }, 2500);
      }

      // Auto-Glas-Ziehen: Bunsen am Hals + an + Zange am Hals + noch kein Schwanenhals
      if (
        effective.bunsenAtNeck &&
        snaps.bunsenAtNeck?.state?.on &&
        effective.tongsAtNeck &&
        effective.neck !== 'swan' &&
        !autoPullingRef.current.has(flask.id)
      ) {
        autoPullingRef.current.add(flask.id);
        dbg('auto-pull-start', { flaskId: flask.id });
        helpers.runPullAnimation(
          {
            bunsen: { x: snaps.bunsenAtNeck.x, y: snaps.bunsenAtNeck.y },
            tongs:  { x: snaps.tongsAtNeck.x,  y: snaps.tongsAtNeck.y },
          },
          1600,
        );
        setTimeout(() => {
          autoPullingRef.current.delete(flask.id);
          helpers.update(flask.id, { neck: 'swan' });
          award('neck_pulled');
          dbg('auto-pull-done', { flaskId: flask.id });
        }, 1500);
      }
    }
  }

  // Snap-Event: nur fuer Meilenstein-Vergabe. State-Flags managt onPlacedChange
  // anhand der Item-Positionen (Source-of-Truth: was steht wirklich wo).
  function handleItemSnapped(dropped, host, slot /*, helpers */) {
    if (host.type !== 'flask_erlenmeyer') return;
    if (slot.id === 'below' && dropped.type === 'bunsen') {
      award('bunsen_below');
    } else if (slot.id === 'neck_heat' && dropped.type === 'bunsen') {
      award('bunsen_at_neck');
    } else if (slot.id === 'neck_pull' && dropped.type === 'tongs') {
      // Zange platzieren ist Setup, kein eigener Meilenstein.
      bump();
    } else {
      bump();
    }
  }

  // User-Aktionen (Drop aus Inventar / Move / Trash) zaehlen ALLE als Aktion.
  // Falls die Aktion einen Meilenstein triggert, ruft `onPlacedChange` danach
  // `award()` auf, was den Idle-Counter wieder auf 0 setzt. Sinnloses Item-
  // Spammen laesst den Counter steigen -> Mood faellt.
  function handleItemPlaced(item) {
    dbg('pasteur-item-placed', { type: item.type, id: item.id });
    bump();
  }
  function handleItemMoved(item) {
    dbg('pasteur-item-moved', { type: item.type, id: item.id });
    bump();
  }
  function handleItemTrashed(item) {
    dbg('pasteur-item-trashed', { type: item.type, id: item.id });
    if (item.type === 'puddle') {
      // Puddle weggemacht -> Smiley darf sich erholen (zurueck zum normalen
      // Idle-basierten Mood). Idle bleibt — Saubermachen ist Pflicht, kein
      // Gewinn.
      setSpilled(false);
      return;
    }
    bump();
  }

  // Pour-Mechanik: Flasche aus dem Regal auf einen Vessel gezogen.
  // Jeder Vessel-Typ (Kolben, Becherglas, Reagenzglas) ist gueltiges Pour-Ziel.
  function handleSourceDropped(sourceType, target, helpers) {
    dbg('pasteur-source-dropped', {
      sourceType,
      targetType: target?.type || null,
      targetId: target?.id || null,
      targetState: target?.state || null,
    });
    if (!target) {
      dbg('pour-skip-no-target', { sourceType });
      bump();
      return;
    }
    if (target.state?.liquid) {
      dbg('pour-skip-already-filled', { sourceType, current: target.state.liquid });
      bump();
      return;
    }
    if (sourceType === 'bottle_unsterile') {
      dbg('pour-fill', { kind: 'unsterile', target: target.type });
      helpers.update({ liquid: 'unsterile', liquidColor: LIQUID_COLOR_UNSTERILE });
      award('liquid_in_flask');
    } else if (sourceType === 'bottle_sterile') {
      // Sterile Bruehe ist ein verfuehrerischer Shortcut — wer mit sterilem
      // Inhalt startet, beweist die Sterilisations-Hypothese nicht (man hat
      // ja gar nichts zu sterilisieren). Liquid setzen, aber:
      //  - KEIN Meilenstein
      //  - Hint einblenden, der's pedagogisch erklaert
      //  - Mood faellt (bump)
      dbg('pour-fill-sterile-shortcut', { target: target.type });
      helpers.update({
        liquid: 'sterile',
        liquidColor: LIQUID_COLOR_STERILE,
        sterilized: true,
        cheated: true, // markiert: Setup ist trivial, Tip-Test sagt eh nix aus
      });
      showHint(
        'Mit steriler Bruehe lernst du nichts ueber Sterilisation — Pasteur startet immer mit *unsteriler* Bruehe und macht sie selbst sauber.',
      );
      bump();
    } else {
      bump();
    }
  }

  const total = progress.size;
  const max = PROGRESS_TARGETS.length;

  return (
    <div className="lab-wrap">
      <ProgressStrip done={total} max={max} progress={progress} />
      {hint && <HintBanner text={hint} onDismiss={() => setHint(null)} />}
      <LabBench
        inventory={inventory}
        mood={mood}
        actionsForItem={actionsForItem}
        onAction={handleAction}
        onPlacedChange={onPlacedChange}
        onSourceDropped={handleSourceDropped}
        onItemPlaced={handleItemPlaced}
        onItemMoved={handleItemMoved}
        onItemTrashed={handleItemTrashed}
        onItemSnapped={handleItemSnapped}
      />
      <p className="lab-hint">
        Items aus der Schublade ziehen, aufs Stativ snappen. Fluessigkeit
        einfuellen: Flasche aus dem Regal auf den Kolben ziehen. Klick auf den
        Erlenmeyer oeffnet das Aktions-Menue (Bunsen drunter, sterilisieren,
        Hals ziehen mit Zange, kippen). Smiley faellt nach drei Aktionen ohne
        Fortschritt — Reihenfolge ist sonst frei.
      </p>
      <LabStyles />
      <MikrobioDebugPanel />
    </div>
  );
}

function HintBanner({ text, onDismiss }) {
  return (
    <div className="lab-hint-banner" role="status" aria-live="polite">
      <span className="lab-hint-banner-icon" aria-hidden="true">!</span>
      <span className="lab-hint-banner-text">{text}</span>
      <button
        type="button"
        className="lab-hint-banner-dismiss"
        onClick={onDismiss}
        aria-label="Hinweis schliessen"
      >
        ×
      </button>
    </div>
  );
}

function ProgressStrip({ done, max, progress }) {
  return (
    <div className="lab-progress">
      <div className="lab-progress-row">
        <span className="lab-progress-label">Experiment-Fortschritt</span>
        <span className="lab-progress-value">
          {done} / {max}
        </span>
      </div>
      <div className="lab-progress-bar">
        <div
          className="lab-progress-fill"
          style={{ width: `${Math.round((done / max) * 100)}%` }}
        />
      </div>
      <ul className="lab-progress-list">
        {PROGRESS_TARGETS.map((id) => (
          <li key={id} className={`lab-progress-chip ${progress.has(id) ? 'lab-progress-chip--done' : ''}`}>
            {labelForEvent(id)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelForEvent(id) {
  switch (id) {
    case 'flask_on_stand': return 'Kolben auf Stativ';
    case 'liquid_in_flask': return 'Fluessigkeit drin';
    case 'bunsen_below':   return 'Bunsen drunter';
    case 'sterilized':     return 'Sterilisiert';
    case 'bunsen_at_neck': return 'Bunsen an Hals';
    case 'neck_pulled':    return 'Hals gezogen';
    case 'tipped':         return 'Gekippt';
    default: return id;
  }
}

// Drei klare Stufen: am Anfang sehr happy, nach 3 Idle-Aktionen neutral,
// nach 6+ traurig. Werte werden auf MoodSmiley-Mundkurve gemappt (-3..+3).
function computeMood(idleActions) {
  if (idleActions <= 2) return 3;
  if (idleActions <= 5) return 0;
  return -3;
}

function Intro({ onContinue }) {
  return (
    <div className="pst-intro-wrap">
      <svg viewBox="0 0 720 380" className="pst-intro-svg" aria-hidden="true">
        <PasteurPortrait />
        <ArrowAndLabel />
        <ThoughtBubble />
      </svg>
      <button type="button" className="pst-intro-btn" onClick={onContinue}>
        Weiter
      </button>
      <Styles />
    </div>
  );
}

function PasteurPortrait() {
  return (
    <g transform="translate(60, 60)">
      <path d="M -10 175 Q 70 185 150 175 L 165 215 L -25 215 Z" fill="#2a2f4a" stroke="#1a1f3a" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M 55 180 L 70 196 L 85 180 L 85 168 L 55 168 Z" fill="#f0e8d8" stroke="#9c8a64" stroke-width="0.8" />
      <path d="M 55 175 L 42 182 L 55 189 Z" fill="#4a2a1a" stroke="#1a0a00" stroke-width="0.6" />
      <path d="M 85 175 L 98 182 L 85 189 Z" fill="#4a2a1a" stroke="#1a0a00" stroke-width="0.6" />
      <circle cx="70" cy="182" r="3" fill="#3a1a0a" />
      <ellipse cx="70" cy="90" rx="48" ry="58" fill="#f4d8b8" stroke="#7a5a3a" stroke-width="1.5" />
      <path d="M 24 80 Q 18 48 28 30 Q 36 32 32 80 Z" fill="#9c9c9c" stroke="#6a6a6a" stroke-width="0.8" />
      <path d="M 116 80 Q 122 48 112 30 Q 104 32 108 80 Z" fill="#9c9c9c" stroke="#6a6a6a" stroke-width="0.8" />
      <path d="M 30 38 Q 70 28 110 38 Q 110 46 70 42 Q 30 46 30 38 Z" fill="#9c9c9c" stroke="#6a6a6a" stroke-width="0.8" />
      <path d="M 50 78 Q 58 74 66 78" fill="none" stroke="#5a5a5a" stroke-width="1.8" stroke-linecap="round" />
      <path d="M 74 78 Q 82 74 90 78" fill="none" stroke="#5a5a5a" stroke-width="1.8" stroke-linecap="round" />
      <ellipse cx="58" cy="86" rx="2.5" ry="3.2" fill="#1a1a1a" />
      <ellipse cx="82" cy="86" rx="2.5" ry="3.2" fill="#1a1a1a" />
      <path d="M 70 96 Q 67 110 70 116 Q 73 118 76 116" fill="none" stroke="#7a5a3a" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 48 124 Q 58 116 70 122 Q 82 116 92 124 Q 96 134 80 134 Q 70 130 60 134 Q 44 134 48 124 Z" fill="#9c9c9c" stroke="#6a6a6a" stroke-width="0.8" stroke-linejoin="round" />
      <path d="M 60 138 Q 70 142 80 138" fill="none" stroke="#7a4040" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 56 144 Q 70 156 84 144 Q 78 158 70 162 Q 62 158 56 144 Z" fill="#9c9c9c" stroke="#6a6a6a" stroke-width="0.8" stroke-linejoin="round" />
    </g>
  );
}

function ArrowAndLabel() {
  return (
    <g>
      <path d="M 200 310 Q 220 285 175 245 Q 145 215 130 192" fill="none" stroke="#c43a3a" stroke-width="2.4" stroke-linecap="round" />
      <polygon points="130,192 138,202 124,205" fill="#c43a3a" stroke="#a02a2a" stroke-width="0.8" stroke-linejoin="round" />
      <text x="208" y="332" font-size="18" font-weight="800" fill="#c43a3a" font-family="ui-sans-serif, system-ui, sans-serif">
        Pasteur
      </text>
    </g>
  );
}

function ThoughtBubble() {
  return (
    <g>
      <circle cx="240" cy="140" r="4.5" fill="#fff" stroke="#5a6a76" stroke-width="1.2" />
      <circle cx="262" cy="118" r="6.5" fill="#fff" stroke="#5a6a76" stroke-width="1.2" />
      <circle cx="290" cy="98" r="8" fill="#fff" stroke="#5a6a76" stroke-width="1.3" />
      <path
        d="M 330 60 C 318 38, 358 30, 372 50 C 388 32, 432 38, 440 60 C 478 50, 510 70, 502 96 C 528 100, 528 132, 502 138 C 510 162, 478 178, 446 168 C 432 184, 388 184, 372 168 C 350 184, 322 168, 322 144 C 296 142, 296 102, 320 100 C 308 80, 318 64, 330 60 Z"
        fill="#fff" stroke="#5a6a76" stroke-width="1.6" stroke-linejoin="round"
      />
      <text x="412" y="82" text-anchor="middle" font-size="14" font-weight="700" fill="#1a1a1a" font-family="ui-sans-serif, system-ui, sans-serif">Spontanzeugung ist Muell.</text>
      <text x="412" y="102" text-anchor="middle" font-size="13" fill="#2a2a2a" font-family="ui-sans-serif, system-ui, sans-serif">Aber wie beweise ich es?</text>
      <text x="412" y="128" text-anchor="middle" font-size="11" fill="#5a5a5a" font-style="italic" font-family="ui-sans-serif, system-ui, sans-serif">Wo Vergammelung anfaengt geht</text>
      <text x="412" y="142" text-anchor="middle" font-size="11" fill="#5a5a5a" font-style="italic" font-family="ui-sans-serif, system-ui, sans-serif">die Vergammelung auch weiter…</text>
      <text x="412" y="160" text-anchor="middle" font-size="13" font-weight="700" fill="#1a1a1a" font-family="ui-sans-serif, system-ui, sans-serif">Hmmmmm</text>
    </g>
  );
}

function Styles() {
  return (
    <style>{`
      .pst-intro-wrap {
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        padding: 1rem 0;
      }
      .pst-intro-svg {
        width: 100%;
        max-width: 760px;
        height: auto;
        display: block;
        border-radius: 1rem;
        background: linear-gradient(180deg, #f4ecd8 0%, #e8d8b8 100%);
        box-shadow: 0 2px 14px rgba(0, 0, 0, 0.18);
      }
      .pst-intro-btn {
        appearance: none;
        border: 1px solid var(--site-card-border);
        background: var(--site-card-bg);
        color: var(--site-body-text);
        padding: 0.7rem 2rem;
        font: inherit;
        font-weight: 700;
        font-size: 1.05rem;
        border-radius: 0.7rem;
        cursor: pointer;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
        transition: transform 0.18s ease, box-shadow 0.18s ease;
      }
      .pst-intro-btn:hover {
        transform: translateY(-2px);
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
      }
      .pst-intro-btn:focus-visible {
        outline: 2px solid var(--site-accent, #6a8caf);
        outline-offset: 2px;
      }
    `}</style>
  );
}

function LabStyles() {
  return (
    <style>{`
      .lab-wrap {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }
      .lab-progress {
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 0.9rem;
        padding: 0.7rem 1rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .lab-progress-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 0.35rem;
      }
      .lab-progress-label {
        font-weight: 600;
      }
      .lab-progress-value {
        font-variant-numeric: tabular-nums;
        color: var(--site-muted);
      }
      .lab-progress-bar {
        height: 0.55rem;
        border-radius: 0.35rem;
        background: rgba(0, 0, 0, 0.08);
        overflow: hidden;
        margin-bottom: 0.6rem;
      }
      .lab-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #6a8caf 0%, #3d8a59 100%);
        transition: width 0.35s ease;
      }
      .lab-progress-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .lab-progress-chip {
        font-size: 0.8rem;
        padding: 0.18rem 0.5rem;
        border-radius: 0.4rem;
        border: 1px solid var(--site-card-border);
        background: var(--site-card-bg);
        color: var(--site-soft-muted);
      }
      .lab-progress-chip--done {
        background: rgba(61, 138, 89, 0.15);
        color: #2f7449;
        border-color: rgba(61, 138, 89, 0.4);
        font-weight: 600;
      }
      .lab-hint {
        margin: 0;
        color: var(--site-muted);
        font-size: 0.9rem;
        line-height: 1.5;
      }
      .lab-hint-banner {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.75rem 1rem;
        background: linear-gradient(180deg, rgba(225, 175, 50, 0.18), rgba(225, 175, 50, 0.08));
        border: 1px solid rgba(180, 130, 30, 0.5);
        border-radius: 0.7rem;
        color: #5a3f15;
        line-height: 1.45;
        font-size: 0.95rem;
      }
      .lab-hint-banner-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.4rem;
        height: 1.4rem;
        flex-shrink: 0;
        border-radius: 50%;
        background: #b56518;
        color: #fff;
        font-weight: 800;
        font-size: 0.95rem;
        line-height: 1;
        margin-top: 0.05rem;
      }
      .lab-hint-banner-text { flex: 1; }
      .lab-hint-banner-dismiss {
        appearance: none;
        background: transparent;
        border: 0;
        color: inherit;
        font-size: 1.3rem;
        line-height: 1;
        cursor: pointer;
        padding: 0 0.2rem;
        opacity: 0.55;
      }
      .lab-hint-banner-dismiss:hover { opacity: 1; }
    `}</style>
  );
}
