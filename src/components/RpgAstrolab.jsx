/**
 * RpgAstrolab — Armillarsphaere als Navigation/Werkzeug-Menue.
 *
 * Eine 3D-artige Messing-Armillarsphaere (SVG) mit ineinandergreifenden Ringen.
 * Kleine Messing-Kugeln (Beads) auf den Ringen sind die klickbaren Werkzeuge.
 *
 * Rotation:
 * - Im Idle langsam (kaum wahrnehmbar).
 * - Cursor in der Naehe des Rands → proportional schnellere Rotation.
 * - Cursor ausserhalb → sanfter Frei-Lauf.
 *
 * Tools:
 * - add: Neue Quest anlegen
 * - edit: Quest/Node bearbeiten
 * - note: Private Notizen (nur wenn canUseNotes)
 * - focus: Auf aktive Quest zentrieren
 * - settings: RPG-Einstellungen (Backups, Theme-Wechsel)
 * - hub: Zum Quest-Hub navigieren
 *
 * Adaptiert aus dem Design-Prototyp (designs/questtree-design-27,4,26/astrolab.jsx)
 * fuer Preact und das bestehende Datensystem.
 */
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { LockGlyphSvg } from '../lib/rpg-lock-icon.jsx';

/**
 * @param {{
 *   activeTool: string;
 *   onTool: (id: string) => void;
 *   canUseNotes?: boolean;
 *   hubLabel?: string;
 * }} props
 */
export default function RpgAstrolab({ activeTool, onTool, canUseNotes = false, hubLabel = 'Hub' }) {
  const [hover, setHover] = useState(/** @type {string | null} */ (null));

  // Euler-Winkel fuer die drei Ringe
  const [a1, setA1] = useState(0);
  const [a2, setA2] = useState(0);
  const [a3, setA3] = useState(0);
  // Globale Neigung (Maus-gesteuert)
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);

  // Werkzeuge: Glyphe, Label, Tooltip, Ring-Zuordnung, Position auf dem Ring (0..1)
  // Lock-Tool sitzt direkt neben der Schere auf demselben Ring \u2014 beide
  // operieren auf Edges (Schere = entfernen, Schloss = sperren), gehoeren
  // also visuell zusammen.
  const TOOLS = [
    { id: 'add', glyph: '+', label: 'Quest +', hint: 'Neue Quest anlegen', ring: 1, t: 0.15 },
    { id: 'edit', glyph: '\u26AF', label: 'Verwalten', hint: 'Quest bearbeiten', ring: 1, t: 0.62 },
    { id: 'cut', glyph: '\u2702', label: 'Schere', hint: 'Verbindung schneiden', ring: 1, t: 0.88 },
    // Lock-Bead: kein Glyph-Text \u2014 wir rendern ein custom SVG (LockGlyphSvg),
    // damit das Symbol monochrom-schlank ist und nicht als Color-Emoji erscheint.
    // `glyph: null` markiert das fuer den Render-Pfad weiter unten.
    { id: 'lock', glyph: null, label: 'Sperre', hint: 'Subtree sperren', ring: 2, t: 0.05 },
    // Notiz nur fuer User mit RPG-Zugang sichtbar
    ...(canUseNotes
      ? [{ id: 'note', glyph: '\u261E', label: 'Notiz', hint: 'Tree-Notiz \u00f6ffnen', ring: 2, t: 0.30 }]
      : []),
    { id: 'focus', glyph: '\u25C9', label: 'Fokus', hint: 'Aktive Quest', ring: 2, t: 0.78 },
    { id: 'settings', glyph: '\u2697', label: 'Alchemie', hint: 'Einstellungen', ring: 3, t: 0.18 },
    { id: 'hub', glyph: '\u2302', label: hubLabel, hint: 'Zum Hub', ring: 3, t: 0.55 },
  ];

  // Radien der drei Ringe
  const RING_R = { 1: 145, 2: 110, 3: 80 };

  // Maus-gesteuerte Rotationsgeschwindigkeit
  const speedRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    /** Berechnet Rotationsimpuls basierend auf Cursor-Position relativ zur Sphaere */
    function onMove(e) {
      const el = document.querySelector('.astrolab');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const radius = r.width / 2;

      if (dist < radius) {
        // Innerhalb der Sphaere: nur am Rand wird Rotation beschleunigt
        const edgeDist = radius - dist;
        const band = 60; // Pixel-Band am Rand
        if (edgeDist > band) {
          // Tief drin — kaum Bewegung
          speedRef.current.x = 0;
          speedRef.current.y = 0;
          return;
        }
        // Naehe 0..1 (1 = direkt am Rand)
        const prox = 1 - edgeDist / band;
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        const strength = prox ** 1.4 * 3.2;
        // Oben am Rad → X-Achsen-Spin nach unten
        speedRef.current.x = (-ny) * strength;
        speedRef.current.y = (nx) * strength;
        return;
      }

      // Ausserhalb → sanfter konstanter Frei-Lauf
      speedRef.current.x = 0.35;
      speedRef.current.y = 0.25;
    }
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Animations-Loop: Idle-Rotation + Maus-Boost
  useEffect(() => {
    let raf;
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sx = speedRef.current.x;
      const sy = speedRef.current.y;
      // Jeder Ring dreht mit leicht unterschiedlicher Geschwindigkeit
      setA1((v) => (v + dt * (1.2 + sy * 50)) % 360);
      setA2((v) => (v + dt * (-0.9 + sx * 50)) % 360);
      setA3((v) => (v + dt * (0.6 + (sx + sy) * 30)) % 360);
      // Globale Neigung folgt der Maus (gedaempft)
      setTiltX((v) => v + (sx * 18 - v) * dt * 2.2);
      setTiltY((v) => v + (sy * 18 - v) * dt * 2.2);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /**
   * Projiziert die 3D-Position eines Tool-Beads ins SVG-Koordinatensystem.
   * Jedes Tool sitzt auf einem Ring; wir rotieren es durch Ring-Spin, Ring-Tilt
   * und globale Maus-Neigung, dann projizieren wir auf 2D.
   */
  const projectToolPos = useCallback((tool) => {
    const theta = tool.t * Math.PI * 2;
    const R = RING_R[tool.ring];
    // Lokale Position auf dem Kreis (in der Ring-Ebene)
    let lx = Math.cos(theta) * R;
    let ly = Math.sin(theta) * R;
    let lz = 0;

    // Ring-spezifische Konfiguration: Neigung + Spin-Winkel
    const rings = {
      1: { tiltX: 0, spin: a1 },
      2: { tiltX: 65, spin: a2 },
      3: { tiltX: -55, spin: a3 },
    };
    const cfg = rings[tool.ring];

    // Spin in der Ring-Ebene
    const sp = cfg.spin * Math.PI / 180;
    const sx = lx * Math.cos(sp) - ly * Math.sin(sp);
    const sy = lx * Math.sin(sp) + ly * Math.cos(sp);
    lx = sx; ly = sy;

    // Tilt um X-Achse (Ring-Neigung)
    const tx = cfg.tiltX * Math.PI / 180;
    const ny = ly * Math.cos(tx) - lz * Math.sin(tx);
    const nz = ly * Math.sin(tx) + lz * Math.cos(tx);
    ly = ny; lz = nz;

    // Globale Neigung (Maus-gesteuert)
    const gx = tiltX * Math.PI / 180;
    const ny2 = ly * Math.cos(gx) - lz * Math.sin(gx);
    const nz2 = ly * Math.sin(gx) + lz * Math.cos(gx);
    ly = ny2; lz = nz2;

    const gy = tiltY * Math.PI / 180;
    const nx2 = lx * Math.cos(gy) + lz * Math.sin(gy);
    const nz3 = -lx * Math.sin(gy) + lz * Math.cos(gy);
    lx = nx2; lz = nz3;

    return { x: lx, y: ly, z: lz };
  }, [a1, a2, a3, tiltX, tiltY]);

  return (
    <div class="astrolab">
      <svg viewBox="-180 -180 360 360" class="astrolab__svg">
        <defs>
          {/* Messing-Gradient fuer die Ringe */}
          <linearGradient id="ringBrass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#3a2a14" />
            <stop offset="0.4" stop-color="#a88a4d" />
            <stop offset="0.55" stop-color="#fbe6a0" />
            <stop offset="0.7" stop-color="#a88a4d" />
            <stop offset="1" stop-color="#3a2a14" />
          </linearGradient>
          {/* Dunklerer Messing-Gradient fuer inneren Ring */}
          <linearGradient id="ringBrassDim" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#2a1f10" />
            <stop offset="0.5" stop-color="#7a5e2c" />
            <stop offset="1" stop-color="#2a1f10" />
          </linearGradient>
          {/* Kugel-Gradient fuer normale Beads */}
          <radialGradient id="bead" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stop-color="#fff7d8" />
            <stop offset="0.4" stop-color="#d4a847" />
            <stop offset="1" stop-color="#3a2a14" />
          </radialGradient>
          {/* Kugel-Gradient fuer aktives Bead (heller, leuchtender) */}
          <radialGradient id="beadActive" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.4" stop-color="#fbe6a0" />
            <stop offset="0.85" stop-color="#c8932f" />
            <stop offset="1" stop-color="#5a4318" />
          </radialGradient>
        </defs>

        {/* Zentraler Pivot-Punkt (Achsen-Kreuzung) */}
        <g transform={`rotate(${tiltY * 0.3})`}>
          <circle r="9" fill="#1a140c" stroke="#a88a4d" stroke-width="1" />
          <circle r="3" fill="#fbe6a0" />
        </g>

        {/* Ring 1 — aeusserer aequatorialer Ring, rotiert um Y-Achse */}
        {(() => {
          const R = RING_R[1];
          // Ellipsen-Projektion: ry aendert sich mit der Neigung
          const ry = R * Math.abs(Math.sin((tiltX + 70) * Math.PI / 180));
          const rotZ = a1 * 0.3;
          return (
            <g transform={`rotate(${rotZ})`}>
              <ellipse cx="0" cy="0" rx={R} ry={Math.max(8, ry)}
                fill="none" stroke="url(#ringBrass)" stroke-width="6" />
              <ellipse cx="0" cy="0" rx={R - 2} ry={Math.max(6, ry - 2)}
                fill="none" stroke="rgba(20,14,4,0.55)" stroke-width="0.8" />
              {/* Grad-Markierungen auf dem Ring */}
              {Array.from({ length: 36 }).map((_, i) => {
                const a = (i * 10) * Math.PI / 180;
                const ix = Math.cos(a) * R;
                const iy = Math.sin(a) * Math.max(8, ry);
                const ox = Math.cos(a) * (R + 4);
                const oy = Math.sin(a) * (Math.max(8, ry) + 4);
                return <line key={`g1-${i}`} x1={ix} y1={iy} x2={ox} y2={oy}
                  stroke="rgba(20,14,4,0.6)" stroke-width={i % 9 === 0 ? 1.2 : 0.5} />;
              })}
            </g>
          );
        })()}

        {/* Ring 2 — Meridian-Ring, 65° geneigt */}
        {(() => {
          const R = RING_R[2];
          const tilt = 65 + tiltX * 0.5;
          const spin = a2;
          const ry = R * Math.abs(Math.cos(tilt * Math.PI / 180));
          return (
            <g transform={`rotate(${spin * 0.4})`}>
              <ellipse cx="0" cy="0" rx={R} ry={Math.max(6, ry)}
                fill="none" stroke="url(#ringBrass)" stroke-width="5"
                transform={`rotate(${tilt * 0.6})`} />
              <ellipse cx="0" cy="0" rx={R - 1.5} ry={Math.max(5, ry - 1.5)}
                fill="none" stroke="rgba(20,14,4,0.5)" stroke-width="0.7"
                transform={`rotate(${tilt * 0.6})`} />
            </g>
          );
        })()}

        {/* Ring 3 — innerer Ring, entgegengesetzte Neigung */}
        {(() => {
          const R = RING_R[3];
          const tilt = -55 + tiltY * 0.4;
          const spin = a3;
          const ry = R * Math.abs(Math.cos(tilt * Math.PI / 180));
          return (
            <g transform={`rotate(${-spin * 0.5})`}>
              <ellipse cx="0" cy="0" rx={R} ry={Math.max(5, ry)}
                fill="none" stroke="url(#ringBrassDim)" stroke-width="4"
                transform={`rotate(${tilt * 0.7})`} />
            </g>
          );
        })()}

        {/* Statischer Rahmen: Zenit-Bogen + Basis-Stuetzen */}
        <g>
          <path d="M -160 0 A 160 160 0 0 1 160 0" fill="none" stroke="url(#ringBrass)" stroke-width="5" />
          <line x1="-165" y1="0" x2="-150" y2="0" stroke="#a88a4d" stroke-width="3" />
          <line x1="150" y1="0" x2="165" y2="0" stroke="#a88a4d" stroke-width="3" />
          {/* Zierknauf oben */}
          <circle cx="0" cy="-160" r="4" fill="#fbe6a0" stroke="#3a2a14" stroke-width="0.5" />
          <circle cx="0" cy="-160" r="1.4" fill="#3a2a14" />
        </g>

        {/* Beads (Tool-Kugeln) — sortiert nach z-Tiefe fuer korrekte Verdeckung */}
        {TOOLS.map((t) => ({ ...t, p: projectToolPos(t) }))
          .sort((a, b) => a.p.z - b.p.z)
          .map((t) => {
            const { x, y, z } = t.p;
            const isActive = activeTool === t.id;
            const isHover = hover === t.id;
            // Perspektivische Skalierung: naeher = groesser
            const beadScale = 0.78 + (z + 150) / 400;
            const baseR = (isActive ? 11 : 9) * beadScale;
            return (
              <g key={t.id}
                onMouseEnter={() => setHover(t.id)}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => { e.stopPropagation(); onTool?.(t.id); }}
                style={{ cursor: 'pointer' }}
              >
                {/* Aeusserer Rand */}
                <circle cx={x} cy={y} r={baseR + 2} fill="none"
                  stroke={isActive ? '#fbe6a0' : '#5a4318'} stroke-width={isActive ? 1.5 : 1} />
                {/* Kugel mit Gradient */}
                <circle cx={x} cy={y} r={baseR}
                  fill={isActive ? 'url(#beadActive)' : 'url(#bead)'}
                  filter={(isHover || isActive) ? 'drop-shadow(0 0 6px rgba(251,230,160,0.8))' : ''}
                />
                {/* Werkzeug-Glyphe: entweder Unicode-Text oder custom SVG-Symbol.
                    `glyph: null` im TOOLS-Eintrag schaltet den SVG-Pfad frei
                    (aktuell nur fuer 'lock' verwendet — schlankes Icon statt Emoji). */}
                {t.glyph !== null ? (
                  <text x={x} y={y + 0.5} font-size={baseR * 1.2}
                    fill="#1a140c" text-anchor="middle" dominant-baseline="middle"
                    style={{ pointerEvents: 'none', fontFamily: 'ui-serif, Georgia, serif', fontWeight: 600 }}>
                    {t.glyph}
                  </text>
                ) : t.id === 'lock' ? (
                  // Custom Lock-Icon — `variant='outline'`: gold-Rand bleibt,
                  // Innen transparent damit der goldene Bead durchschimmert.
                  // Cursor verwendet weiterhin 'solid' (Default), wo voller
                  // Goldfuellung fuer Lesbarkeit auf beliebigem Untergrund sorgt.
                  <LockGlyphSvg x={x} y={y} size={baseR * 1.6} variant="outline" />
                ) : null}
              </g>
            );
          })}

        {/* Zentrale Achsen-Kappe (obendrauf) */}
        <circle r="6" fill="#1a140c" stroke="#a88a4d" stroke-width="1" />
      </svg>

      {/* Tooltip bei Hover */}
      {hover && (
        <div class="astrolab__tooltip">
          {TOOLS.find(s => s.id === hover)?.label}
          <span>{TOOLS.find(s => s.id === hover)?.hint}</span>
        </div>
      )}
    </div>
  );
}
