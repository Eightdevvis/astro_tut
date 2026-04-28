// Astrolab — Armillarsphäre. Mehrere ineinandergreifende Messing-Ringe in 3D.
// Kleine Messing-Kugeln auf den Ringen sind die klickbaren Werkzeuge.
// Rotation: idle slow, plus mouse-position-driven.

function Astrolab({ activeTool, onTool, hubLabel = 'Hub' }) {
  const [hover, setHover] = React.useState(null);
  // Each ring has its own euler angle (around its primary axis)
  const [a1, setA1] = React.useState(0); // outer ring (y axis)
  const [a2, setA2] = React.useState(0); // mid ring (x axis tilted)
  const [a3, setA3] = React.useState(0); // inner ring
  // Whole sphere base tilt
  const [tiltX, setTiltX] = React.useState(0);
  const [tiltY, setTiltY] = React.useState(0);

  const TOOLS = [
    { id: 'add',    glyph: '+',  label: 'Quest +',     hint: 'Neue Quest anlegen', ring: 1, t: 0.15 },
    { id: 'edit',   glyph: '⚯',  label: 'Verwalten',   hint: 'Knoten bearbeiten',  ring: 1, t: 0.62 },
    { id: 'note',   glyph: '☞',  label: 'Notiz',       hint: 'Tree-Notiz öffnen',  ring: 2, t: 0.30 },
    { id: 'focus',  glyph: '◉',  label: 'Fokus',       hint: 'Aktive Quest',       ring: 2, t: 0.78 },
    { id: 'hub',    glyph: '⌂',  label: hubLabel,      hint: 'Zum Hub',            ring: 3, t: 0.45 },
  ];

  // Mouse-driven rotation speed
  const speedRef = React.useRef({ x: 0, y: 0 });
  React.useEffect(() => {
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

      // Inside wheel area → idle slow, but edge-band within radius boosts rotation
      if (dist < radius) {
        // distance from cursor to nearest wheel edge (positive = inside, smaller = closer to edge)
        const edgeDist = radius - dist; // px from edge
        const band = 60; // px band near rim where boost kicks in
        if (edgeDist > band) {
          // deep inside — wheel barely moves
          speedRef.current.x = 0;
          speedRef.current.y = 0;
          return;
        }
        // proximity 0..1 (1 = right at edge)
        const prox = 1 - edgeDist / band;
        // direction the cursor is FROM center → flip semantics:
        // cursor near top edge inside the wheel → rotate downward
        // cursor near left edge → rotate upward
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        const strength = prox ** 1.4 * 3.2;
        // top of wheel (ny < 0) should produce X-axis spin downward (positive X tilt)
        // left of wheel (nx < 0) should produce Y-axis spin upward — interpret as positive sx
        speedRef.current.x = (-ny) * strength;  // ny negative → positive sx → "down" spin
        speedRef.current.y = ( nx) * strength;
        return;
      }

      // Outside wheel → constant gentle spin (wheel is "free running")
      speedRef.current.x = 0.35;
      speedRef.current.y = 0.25;
    }
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Idle slow rotation + mouse boost. Each ring spins at slightly different rates.
  React.useEffect(() => {
    let raf, last = performance.now();
    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const sx = speedRef.current.x, sy = speedRef.current.y;
      // Idle = sehr langsam (kaum wahrnehmbar). Edge-Boost ist exponentiell.
      setA1((v) => (v + dt * (1.2 + sy * 50)) % 360);
      setA2((v) => (v + dt * (-0.9 + sx * 50)) % 360);
      setA3((v) => (v + dt * (0.6 + (sx + sy) * 30)) % 360);
      setTiltX((v) => v + (sx * 18 - v) * dt * 2.2);
      setTiltY((v) => v + (sy * 18 - v) * dt * 2.2);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const RING_R = { 1: 145, 2: 110, 3: 80 };

  // For each tool, compute SVG (cx,cy) by:
  //  - placing it at angle θ = t * 360° on a ring of radius R
  //  - then applying that ring's rotation around its axis
  //  - we project to 2D by treating ring 1 as "horizontal hoop" (rotates around vertical axis = y),
  //    ring 2 as "vertical hoop tilted 60°" (rotates around an axis tilted),
  //    ring 3 as another tilted hoop
  // For simplicity, we render the points as 2D after a per-ring affine.
  function projectToolPos(tool) {
    const θ = tool.t * Math.PI * 2;
    const R = RING_R[tool.ring];
    // Local on circle (in ring's plane)
    let lx = Math.cos(θ) * R;
    let ly = Math.sin(θ) * R;
    let lz = 0;
    // Each ring has its own "tilt" around X, then spin around its normal
    const rings = {
      1: { tiltX: 0,    spin: a1 },
      2: { tiltX: 65,   spin: a2 },
      3: { tiltX: -55,  spin: a3 },
    };
    const cfg = rings[tool.ring];
    const sp = cfg.spin * Math.PI / 180;
    // spin around ring normal (assume normal = ring's z): rotate within plane
    const sx = lx * Math.cos(sp) - ly * Math.sin(sp);
    const sy = lx * Math.sin(sp) + ly * Math.cos(sp);
    lx = sx; ly = sy;
    // tilt around X axis: y' = y·cos - z·sin, z' = y·sin + z·cos
    const tx = cfg.tiltX * Math.PI / 180;
    const ny = ly * Math.cos(tx) - lz * Math.sin(tx);
    const nz = ly * Math.sin(tx) + lz * Math.cos(tx);
    ly = ny; lz = nz;
    // global tilt (mouse-driven)
    const gx = tiltX * Math.PI / 180;
    const ny2 = ly * Math.cos(gx) - lz * Math.sin(gx);
    const nz2 = ly * Math.sin(gx) + lz * Math.cos(gx);
    ly = ny2; lz = nz2;
    const gy = tiltY * Math.PI / 180;
    const nx2 = lx * Math.cos(gy) + lz * Math.sin(gy);
    const nz3 = -lx * Math.sin(gy) + lz * Math.cos(gy);
    lx = nx2; lz = nz3;
    return { x: lx, y: ly, z: lz };
  }

  return (
    <div className="astrolab">
      <svg viewBox="-180 -180 360 360" className="astrolab__svg">
        <defs>
          <linearGradient id="ringBrass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a2a14" />
            <stop offset="0.4" stopColor="#a88a4d" />
            <stop offset="0.55" stopColor="#fbe6a0" />
            <stop offset="0.7" stopColor="#a88a4d" />
            <stop offset="1" stopColor="#3a2a14" />
          </linearGradient>
          <linearGradient id="ringBrassDim" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2a1f10" />
            <stop offset="0.5" stopColor="#7a5e2c" />
            <stop offset="1" stopColor="#2a1f10" />
          </linearGradient>
          <radialGradient id="bead" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stopColor="#fff7d8" />
            <stop offset="0.4" stopColor="#d4a847" />
            <stop offset="1" stopColor="#3a2a14" />
          </radialGradient>
          <radialGradient id="beadActive" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#fbe6a0" />
            <stop offset="0.85" stopColor="#c8932f" />
            <stop offset="1" stopColor="#5a4318" />
          </radialGradient>
          <filter id="beadGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Center hub — small armilla pivot */}
        <g transform={`rotate(${tiltY * 0.3})`}>
          <circle r="9" fill="#1a140c" stroke="#a88a4d" strokeWidth="1" />
          <circle r="3" fill="#fbe6a0" />
        </g>

        {/* Ring 1 — horizontal equatorial. Spins around Y (vertical) axis → ellipse with horizontal width changing */}
        {(() => {
          const R = RING_R[1];
          // Treat ring 1 as a flat hoop tilted by tiltY (mouse y) around X, then by tiltX around Y? Use simple ellipse.
          const ry = R * Math.abs(Math.sin((tiltX + 70) * Math.PI / 180));
          const rotZ = a1 * 0.3;
          return (
            <g transform={`rotate(${rotZ})`}>
              <ellipse cx="0" cy="0" rx={R} ry={Math.max(8, ry)}
                fill="none" stroke="url(#ringBrass)" strokeWidth="6" />
              <ellipse cx="0" cy="0" rx={R - 2} ry={Math.max(6, ry - 2)}
                fill="none" stroke="rgba(20,14,4,0.55)" strokeWidth="0.8" />
              {/* graduations */}
              {Array.from({ length: 36 }).map((_, i) => {
                const a = (i * 10) * Math.PI / 180;
                const ix = Math.cos(a) * R, iy = Math.sin(a) * Math.max(8, ry);
                const ox = Math.cos(a) * (R + 4), oy = Math.sin(a) * (Math.max(8, ry) + 4);
                return <line key={'g1'+i} x1={ix} y1={iy} x2={ox} y2={oy}
                  stroke="rgba(20,14,4,0.6)" strokeWidth={i % 9 === 0 ? 1.2 : 0.5} />;
              })}
            </g>
          );
        })()}

        {/* Ring 2 — meridian tilted 65° */}
        {(() => {
          const R = RING_R[2];
          const tilt = 65 + tiltX * 0.5;
          const spin = a2;
          // ellipse with rx=R, ry=R*cos(tilt), rotated by spin
          const ry = R * Math.abs(Math.cos(tilt * Math.PI / 180));
          return (
            <g transform={`rotate(${spin * 0.4})`}>
              <ellipse cx="0" cy="0" rx={R} ry={Math.max(6, ry)}
                fill="none" stroke="url(#ringBrass)" strokeWidth="5" transform={`rotate(${tilt * 0.6})`} />
              <ellipse cx="0" cy="0" rx={R - 1.5} ry={Math.max(5, ry - 1.5)}
                fill="none" stroke="rgba(20,14,4,0.5)" strokeWidth="0.7" transform={`rotate(${tilt * 0.6})`} />
            </g>
          );
        })()}

        {/* Ring 3 — inner, opposite tilt */}
        {(() => {
          const R = RING_R[3];
          const tilt = -55 + tiltY * 0.4;
          const spin = a3;
          const ry = R * Math.abs(Math.cos(tilt * Math.PI / 180));
          return (
            <g transform={`rotate(${-spin * 0.5})`}>
              <ellipse cx="0" cy="0" rx={R} ry={Math.max(5, ry)}
                fill="none" stroke="url(#ringBrassDim)" strokeWidth="4" transform={`rotate(${tilt * 0.7})`} />
            </g>
          );
        })()}

        {/* Static frame (zenith arc + base) — fixed gold scaffold */}
        <g>
          <path d="M -160 0 A 160 160 0 0 1 160 0" fill="none" stroke="url(#ringBrass)" strokeWidth="5" />
          <line x1="-165" y1="0" x2="-150" y2="0" stroke="#a88a4d" strokeWidth="3" />
          <line x1="150" y1="0" x2="165" y2="0" stroke="#a88a4d" strokeWidth="3" />
          {/* finial */}
          <circle cx="0" cy="-160" r="4" fill="#fbe6a0" stroke="#3a2a14" strokeWidth="0.5" />
          <circle cx="0" cy="-160" r="1.4" fill="#3a2a14" />
        </g>

        {/* Beads (tools) — sorted by z so back ones render first */}
        {TOOLS.map((t) => ({ ...t, p: projectToolPos(t) }))
          .sort((a, b) => a.p.z - b.p.z)
          .map((t) => {
            const { x, y, z } = t.p;
            const isActive = activeTool === t.id;
            const isHover = hover === t.id;
            const scale = 0.78 + (z + 150) / 400;  // closer = bigger
            const baseR = (isActive ? 11 : 9) * scale;
            return (
              <g key={t.id}
                onMouseEnter={() => setHover(t.id)}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => { e.stopPropagation(); onTool && onTool(t.id); }}
                style={{ cursor: 'pointer' }}
              >
                {/* outer rim */}
                <circle cx={x} cy={y} r={baseR + 2} fill="none"
                  stroke={isActive ? '#fbe6a0' : '#5a4318'} strokeWidth={isActive ? 1.5 : 1} />
                {/* bead */}
                <circle cx={x} cy={y} r={baseR}
                  fill={isActive ? 'url(#beadActive)' : 'url(#bead)'}
                  filter={isHover || isActive ? 'drop-shadow(0 0 6px rgba(251,230,160,0.8))' : ''}
                />
                {/* glyph */}
                <text x={x} y={y + 0.5} fontSize={baseR * 1.2}
                  fill={isActive ? '#1a140c' : '#1a140c'} textAnchor="middle" dominantBaseline="middle"
                  style={{ pointerEvents: 'none', fontFamily: 'ui-serif, Georgia, serif', fontWeight: 600 }}>
                  {t.glyph}
                </text>
              </g>
            );
          })}

        {/* Center boss on top */}
        <circle r="6" fill="#1a140c" stroke="#a88a4d" strokeWidth="1" />
      </svg>

      {hover && (
        <div className="astrolab__tooltip">
          {TOOLS.find(s => s.id === hover)?.label}
          <span>{TOOLS.find(s => s.id === hover)?.hint}</span>
        </div>
      )}
    </div>
  );
}

window.Astrolab = Astrolab;
