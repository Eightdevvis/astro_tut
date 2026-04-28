// Vessels — Glaskugel (Mana) + Glasherz (Leben). Echte Glas-Optik mit:
//  - dicker Glasrand mit Refraktion + Inner Highlight
//  - leicht transparente Flüssigkeit
//  - feine, langsame Glitzer-Partikel (kein "Kochen")
//  - tiefes Rot für Leben
//  - mehrere Specular-Highlights für 3D-Optik

function Vessel({ kind, value, max }) {
  const canvasRef = React.useRef(null);
  const pct = Math.max(0, Math.min(1, value / max));

  React.useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    let raf, t0 = performance.now();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    // Set canvas backing store size once at high DPI
    function resize() {
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
    }
    resize();

    const palette = kind === 'heart'
      ? {
          deep:   '#3a0610',
          mid:    '#7a0a18',
          core:   '#a8121f',
          glow:   '#d8324a',
          rim:    '#f08090',
          spark:  '255,210,220',
        }
      : {
          deep:   '#062a3a',
          mid:    '#0e5670',
          core:   '#1a8aa8',
          glow:   '#3ec8d4',
          rim:    '#a8f0f0',
          spark:  '200,245,250',
        };

    // Pre-build stable sparkle seeds (so positions don't churn each frame)
    const sparks = Array.from({ length: 18 }, (_, i) => ({
      seed: i,
      // angular position around vessel center
      ang: (i * 137.5 + (kind === 'heart' ? 41 : 17)) % 360,
      // radial 0..1 (depth from center)
      rad: 0.15 + ((i * 0.231) % 0.78),
      // phase offset for blink
      ph: (i * 0.27) % 1,
      // depth for parallax
      depth: 0.4 + ((i * 0.13) % 0.6),
    }));

    function draw(now) {
      const t = (now - t0) / 1000;
      const W = cv.width, H = cv.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
      ctx.save();
      const w = cv.clientWidth, h = cv.clientHeight;

      // ===== Build vessel shape path =====
      function vesselPath(p) {
        p.beginPath();
        if (kind === 'mana') {
          const cx = w / 2, cy = h / 2 + 4;
          const r = Math.min(w, h) * 0.42;
          p.arc(cx, cy, r, 0, Math.PI * 2);
          return { cx, cy, top: cy - r, bottom: cy + r, r, kind: 'sphere' };
        } else {
          const cx = w / 2, cy = h * 0.46;
          const s = Math.min(w, h) * 0.50;
          p.moveTo(cx, cy + s * 0.92);
          p.bezierCurveTo(cx - s * 1.12, cy + s * 0.18, cx - s * 0.96, cy - s * 0.72, cx, cy - s * 0.14);
          p.bezierCurveTo(cx + s * 0.96, cy - s * 0.72, cx + s * 1.12, cy + s * 0.18, cx, cy + s * 0.92);
          p.closePath();
          return { cx, cy, top: cy - s * 0.55, bottom: cy + s * 0.92, r: s, kind: 'heart' };
        }
      }

      // ===== Outer glow (subtle) =====
      ctx.save();
      const outerGlow = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w * 0.55);
      outerGlow.addColorStop(0, kind === 'heart' ? 'rgba(216,50,74,0.16)' : 'rgba(90,154,224,0.16)');
      outerGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = outerGlow;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // ===== Glass body =====
      const shape = vesselPath(ctx);
      ctx.save();
      ctx.clip();

      // Dark glass interior tint (so codex/parchment mode still shows dark vessel inside)
      const glassBg = ctx.createRadialGradient(shape.cx - shape.r * 0.3, shape.cy - shape.r * 0.4, 0, shape.cx, shape.cy, shape.r * 1.1);
      glassBg.addColorStop(0, 'rgba(40,30,55,0.18)');
      glassBg.addColorStop(0.55, 'rgba(15,12,22,0.28)');
      glassBg.addColorStop(1, 'rgba(4,3,7,0.42)');
      ctx.fillStyle = glassBg;
      ctx.fillRect(0, 0, w, h);

      // ===== Liquid =====
      const liquidTop = shape.top + (1 - pct) * (shape.bottom - shape.top);
      // Very gentle wave (long period, small amplitude — no "boiling")
      const waveA = Math.sin(t * 0.8) * 0.9;
      const waveB = Math.cos(t * 0.55 + 1) * 0.6;

      // Liquid base — semi-transparent so glass bg shows thru in dark areas
      ctx.save();
      ctx.globalAlpha = 0.82;
      const liq = ctx.createLinearGradient(0, liquidTop, 0, shape.bottom);
      liq.addColorStop(0, palette.glow);
      liq.addColorStop(0.25, palette.core);
      liq.addColorStop(0.65, palette.mid);
      liq.addColorStop(1, palette.deep);
      ctx.fillStyle = liq;
      ctx.beginPath();
      ctx.moveTo(0, liquidTop + waveA);
      ctx.bezierCurveTo(w * 0.3, liquidTop - 1.2 + waveB, w * 0.7, liquidTop + 1.2 + waveA, w, liquidTop + waveB);
      ctx.lineTo(w, h); ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Subtle inner depth (darker toward bottom)
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const depth = ctx.createLinearGradient(0, liquidTop, 0, shape.bottom);
      depth.addColorStop(0, 'rgba(255,255,255,1)');
      depth.addColorStop(1, 'rgba(40,20,30,1)');
      ctx.fillStyle = depth;
      ctx.fillRect(0, liquidTop, w, shape.bottom - liquidTop);
      ctx.restore();

      // ===== Glitter — fine, slow, soft =====
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      sparks.forEach((s) => {
        // Each spark slowly drifts upward then resets
        const cyc = ((t * 0.06 * s.depth + s.ph) % 1);
        // Position relative to vessel center, drifting up
        const angle = (s.ang + t * 2 * s.depth) * Math.PI / 180;
        const sliceR = s.rad * shape.r;
        // Center based on shape
        const baseX = shape.cx + Math.cos(angle) * sliceR * (kind === 'heart' ? 0.85 : 1.0);
        // Y range: bottom of liquid up to surface, modulated by cyc
        const bottomBound = shape.bottom - 6;
        const topBound = liquidTop + 4;
        const range = bottomBound - topBound;
        const baseY = bottomBound - cyc * range;
        // Skip if outside liquid
        if (baseY < topBound + 1 || baseY > bottomBound) return;

        // Twinkle envelope: slow sine in/out
        const tw = (Math.sin(t * 1.4 * s.depth + s.seed * 1.31) + 1) * 0.5;
        const fade = Math.sin(cyc * Math.PI); // 0 at start/end, 1 mid-life
        const alpha = 0.35 * tw * fade;
        if (alpha < 0.02) return;
        const sz = 0.35 + tw * 0.9;

        // Soft halo
        const grad = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, sz * 4);
        grad.addColorStop(0, `rgba(${palette.spark},${alpha})`);
        grad.addColorStop(0.4, `rgba(${palette.spark},${alpha * 0.4})`);
        grad.addColorStop(1, `rgba(${palette.spark},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(baseX, baseY, sz * 4, 0, Math.PI * 2);
        ctx.fill();

        // Crisp center
        ctx.fillStyle = `rgba(255,255,255,${alpha * 1.2})`;
        ctx.beginPath();
        ctx.arc(baseX, baseY, sz * 0.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // ===== Surface meniscus =====
      ctx.save();
      const mw = ctx.createLinearGradient(0, liquidTop - 4, 0, liquidTop + 5);
      mw.addColorStop(0, 'rgba(255,255,255,0)');
      mw.addColorStop(0.5, `rgba(255,255,255,${0.18 + Math.sin(t * 0.9) * 0.04})`);
      mw.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mw;
      ctx.fillRect(0, liquidTop - 4, w, 9);
      ctx.restore();

      ctx.restore(); // end clip

      // ===== Glass highlights (outside clip so they sit on top) =====
      ctx.save();
      ctx.beginPath();
      vesselPath(ctx);
      ctx.clip();

      // Upper-left main specular
      ctx.save();
      const sx = shape.cx - shape.r * 0.4;
      const sy = shape.top + shape.r * 0.18;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, shape.r * 0.55);
      sg.addColorStop(0, 'rgba(255,255,255,0.55)');
      sg.addColorStop(0.4, 'rgba(255,255,255,0.18)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(sx, sy, shape.r * 0.35, shape.r * 0.55, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Smaller secondary highlight
      ctx.save();
      const s2x = shape.cx - shape.r * 0.22;
      const s2y = shape.top + shape.r * 0.42;
      const sg2 = ctx.createRadialGradient(s2x, s2y, 0, s2x, s2y, shape.r * 0.18);
      sg2.addColorStop(0, 'rgba(255,255,255,0.5)');
      sg2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg2;
      ctx.beginPath();
      ctx.ellipse(s2x, s2y, shape.r * 0.07, shape.r * 0.16, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bottom rim light (refraction-ish)
      ctx.save();
      const rx = shape.cx + shape.r * 0.3;
      const ry = shape.bottom - shape.r * 0.15;
      const rg = ctx.createRadialGradient(rx, ry, 0, rx, ry, shape.r * 0.5);
      rg.addColorStop(0, `rgba(${palette.spark},0.35)`);
      rg.addColorStop(0.4, `rgba(${palette.spark},0.12)`);
      rg.addColorStop(1, `rgba(${palette.spark},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(rx, ry, shape.r * 0.45, shape.r * 0.18, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Fresnel rim — feiner heller Rand (subpixel-smooth)
      ctx.save();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = `rgba(${palette.spark},0.55)`;
      ctx.beginPath();
      vesselPath(ctx);
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.restore();

      // Inner shadow (concave glass thickness) — sehr dezent
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      vesselPath(ctx);
      ctx.stroke();
      ctx.restore();

      ctx.restore(); // end inner clip

      // ===== Outer glass edge stroke + pinpoint (innerhalb des Pfads geclippt) =====
      ctx.save();
      ctx.beginPath();
      vesselPath(ctx);
      ctx.clip();

      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      vesselPath(ctx);
      ctx.stroke();

      // Tiny pinpoint specular (top) — wird durch Clip am Glasrand abgeschnitten
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(shape.cx - shape.r * 0.45, shape.top + shape.r * 0.1, 1.6, 3.2, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, pct]);

  return (
    <div className={`vessel vessel--${kind}`}>
      <canvas ref={canvasRef} />
      <div className="vessel__label">
        <span className="vessel__num">{value}</span>
        <span className="vessel__sep">/</span>
        <span className="vessel__max">{max}</span>
      </div>
    </div>
  );
}

window.Vessel = Vessel;
