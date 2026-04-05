/**
 * Dynamisches Gleichungspuzzle — Fluss / Gradient / Sattel.
 * Eine Simulationsquelle: dieselbe rechte Seite treibt Canvas + Formeln.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import katex from 'katex';

import 'katex/dist/katex.min.css';

const WORLD = 2.6;
const DT = 0.025;
const MAX_STEPS_PER_FRAME = 6;
const GOAL_R = 0.32;
/** Abstand zum Fixpunkt / Minimum, ab dem „zur Ruhe gekommen“ gilt (Ziel verfehlt). */
const SETTLE_DIST = 0.04;
const SETTLE_SPEED = 0.075;
/** Maximale Laufzeit der Simulation (ms), damit nicht endlos weiterläuft. */
const MAX_PLAY_MS = 42000;
const FIELD_GRID = 17;

/** @typedef {{ x: number; y: number }} Vec2 */

function v(x, y) {
  return { x, y };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

function len(a) {
  return Math.hypot(a.x, a.y);
}

function norm(a) {
  const L = len(a);
  if (L < 1e-12) return { x: 0, y: 0 };
  return { x: a.x / L, y: a.y / L };
}

/**
 * @param {(pos: Vec2) => Vec2} rhs
 * @param {Vec2} x0
 * @param {number} dt
 */
function rk4Step(rhs, x0, dt) {
  const k1 = rhs(x0);
  const k2 = rhs(add(x0, scale(k1, dt * 0.5)));
  const k3 = rhs(add(x0, scale(k2, dt * 0.5)));
  const k4 = rhs(add(x0, scale(k3, dt)));
  return add(x0, scale(add(add(k1, scale(k2, 2)), add(scale(k3, 2), k4)), dt / 6));
}

/** @type {const} */
const LEVELS = [
  {
    id: 'a1',
    series: 'A',
    title: 'Fluss zum Ziel',
    blurb:
      'Die grüne Scheibe ist eine Zielzone — der Fluss zieht zum roten Anker g. Die Trajektorie ist eine Gerade: nur wenn diese Zone auf dem Weg von Start zu g liegt, „triffst“ du sie. Sonst landest du bei g ohne Treffer.',
    mode: 'ode',
    odeKind: 'linearAttractor',
    k: 1.15,
    g: v(0.55, 0.35),
    /** Fixe Zielzone (≠ g): nicht jede Startlage schneidet die Gerade Start→g. */
    goal: v(0.22, -0.18),
    x0: v(-1.15, -0.75),
    dragParticle: true,
    dragG: false,
    showPotential: false,
    glossaryKeys: ['state', 'vectorField', 'ode', 'integrator'],
  },
  {
    id: 'a2',
    series: 'A',
    title: 'Anker verschieben',
    blurb:
      'Zielzone (grün) ist fest. Verschiebe g (rot), bis die Flussgerade vom Start durch die Zone läuft — sonst läuft der Punkt an der Zone vorbei zum Anker.',
    mode: 'ode',
    odeKind: 'linearAttractor',
    k: 1.15,
    g: v(0.2, -0.1),
    goal: v(-0.35, 0.55),
    x0: v(-1.0, 0.9),
    dragParticle: true,
    dragG: true,
    showPotential: false,
    glossaryKeys: ['state', 'vectorField', 'ode', 'integrator', 'parameter'],
  },
  {
    id: 'b1',
    series: 'B',
    title: 'Tal rollen (Potential)',
    blurb:
      'Wie bei A: grüne Zielzone und tiefstes Tal (g) sind getrennt. Schiebe g so, dass der Gradientenfluss die Zone auf dem Weg ins Tal trifft.',
    mode: 'potential',
    potentialKind: 'quadraticWell',
    k: 1.0,
    g: v(-0.25, 0.45),
    goal: v(0.4, -0.15),
    x0: v(1.1, -0.9),
    dragParticle: true,
    dragG: true,
    showPotential: true,
    glossaryKeys: ['state', 'potential', 'gradient', 'ode', 'integrator'],
  },
  {
    id: 'b2',
    series: 'B',
    title: 'Zwei Täler',
    blurb:
      'Nur das linke Tal (grüne Scheibe) zählt als Ziel. Starte im Einzugsgebiet des linken Minimums — sonst rollt der Punkt zum anderen Tal.',
    mode: 'potential',
    potentialKind: 'doubleWell',
    sigma: 0.55,
    p1: v(-0.85, 0.35),
    p2: v(0.95, -0.25),
    /** Gewinnt nur, wenn das linke Minimum p1 erreicht wird. */
    winMinimum: 'p1',
    /** Start nahe p2 → erstes Abspielen läuft typischerweise ins rechte Tal (verloren). */
    x0: v(0.88, -0.2),
    dragParticle: true,
    dragG: false,
    showPotential: true,
    glossaryKeys: ['state', 'potential', 'gradient', 'localMinimum', 'integrator'],
  },
  {
    id: 'c1',
    series: 'C',
    title: 'Sattel & Sensitivität',
    blurb: 'Ein instabiler Ursprung — kleine Startänderungen können große Enden ändern.',
    mode: 'saddle',
    x0: v(0.42, 0.48),
    goal: v(1.25, 0),
    dragParticle: true,
    showPotential: false,
    glossaryKeys: ['state', 'vectorField', 'saddle', 'sensitivity', 'ode', 'integrator'],
  },
];

const GLOSSARY = {
  state: {
    title: 'Zustand x',
    short: 'Ein Punkt in der Ebene beschreibt den aktuellen Zustand des Systems.',
    long:
      'Wir schreiben x = (x₁, x₂) ∈ ℝ². Im Spiel ist das die Position des Partikels. Kontinuierlich: ẋ = f(x). Auf dem Rechner wird die Zeit in Schritte der Länge h zerlegt; der einfachste Eulerschritt wäre xₖ₊₁ ≈ xₖ + h f(xₖ) — diese Simulation nutzt stattdessen RK4 (genauer bei gleichem h).',
  },
  vectorField: {
    title: 'Vektorfeld f(x)',
    short: 'An jedem Ort zeigt ein Pfeil, wohin der Zustand „sofort“ tendiert.',
    long:
      'Das Vektorfeld f ordnet jedem x eine Richtung und eine Geschwindigkeit zu. Integralkurven (Trajektorien) folgen diesem Feld; sie lösen ẋ = f(x).',
  },
  ode: {
    title: 'Autonome Differentialgleichung',
    short: 'ẋ = f(x) — die Änderung hängt nur vom aktuellen Zustand ab.',
    long:
      '„Autonom“ heißt: keine explizite Zeit in f (kein f(t,x) nötig für diese Level). Lösungen können zu Fixpunkten, Grenzyklen oder chaotischen Attraktoren streben — hier bewusst einfache Felder.',
  },
  integrator: {
    title: 'Numerische Integration (RK4)',
    short: 'Der Computer schlägt die Zeit in kleine Schritte h ein und summiert Näherungen.',
    long:
      'Wir verwenden das klassische Runge–Kutta-Verfahren 4. Ordnung (RK4): pro Schritt werden vier Hilfsrichtungen gemittelt. So bleibt der Schrittfehler klein bei moderatem h.',
  },
  parameter: {
    title: 'Parameter',
    short: 'Größen, die das Modell festlegen, aber nicht dynamisch mitlaufen wie x.',
    long:
      'Hier ist der Anker g ein Parameter: du setzt ihn, dann ist f(x) = −k(x−g) ein festes Feld bis zum nächsten Ziehen. Parameter unterscheiden sich vom Zustand x, der sich entlang des Flusses bewegt.',
  },
  potential: {
    title: 'Potential V(x)',
    short: 'Eine „Höhenlandschaft“; der Fluss folgt oft dem Abhang nach unten.',
    long:
      'Wenn V glatt ist und ẋ = −∇V(x), bewegt sich der Zustand in Richtung des steilsten Abstiegs — das ist Gradientenabstieg, eng mit Optimierung verwandt.',
  },
  gradient: {
    title: 'Gradient ∇V',
    short: 'Zeigt die Richtung des steilsten Anstiegs von V; −∇V ist der Abstieg.',
    long:
      'In ℝ² ist ∇V = (∂V/∂x₁, ∂V/∂x₂). Höhenlinien (Niveaumengen) stehen senkrecht auf ∇V.',
  },
  localMinimum: {
    title: 'Lokales Minimum',
    short: 'Ein Punkt, in dem V in der Umgebung am kleinsten ist — nicht unbedingt global.',
    long:
      'Bei mehreren Tälern kann der Gradientenfluss, je nach Startpunkt, in verschiedene Minima enden — „Einzugsgebiete“ entstehen.',
  },
  saddle: {
    title: 'Sattelpunkt',
    short: 'Ein Gleichgewicht, das in einer Richtung anzieht und in einer anderen abstößt.',
    long:
      'Linear: Eigenwerte mit unterschiedlichem Vorzeichen. Trajektorien können entlang separater Mannigfaltigkeiten einlaufen — deshalb hohe Sensitivität am Sattel.',
  },
  sensitivity: {
    title: 'Sensitivität',
    short: 'Kleine Änderungen am Start können große Änderungen später erzeugen.',
    long:
      'Bei nichtlinearen oder Sattel-Geometrien können nahe Starts auseinanderlaufen (Lyapunov-Exponenten quantifizieren das in komplexeren Systemen).',
  },
};

function clampWorld(p) {
  const w = WORLD - 0.08;
  return {
    x: Math.max(-w, Math.min(w, p.x)),
    y: Math.max(-w, Math.min(w, p.y)),
  };
}

/** @param {typeof LEVELS[number]} level */
function makeRhs(level, mutable) {
  if (level.mode === 'ode' && level.odeKind === 'linearAttractor') {
    const k = level.k;
    const g = mutable.g;
    return (x) => scale(sub(x, g), -k);
  }
  if (level.mode === 'potential' && level.potentialKind === 'quadraticWell') {
    const g = mutable.g;
    const k = level.k ?? 1;
    return (x) => scale(sub(x, g), -k);
  }
  if (level.mode === 'potential' && level.potentialKind === 'doubleWell') {
    const s = level.sigma;
    const p1 = level.p1;
    const p2 = level.p2;
    const c = 2 / (s * s);
    return (x) => {
      const d1 = sub(x, p1);
      const d2 = sub(x, p2);
      const E1 = Math.exp(-(len(d1) ** 2) / (s * s));
      const E2 = Math.exp(-(len(d2) ** 2) / (s * s));
      const gradV = add(scale(d1, c * E1), scale(d2, c * E2));
      return scale(gradV, -1);
    };
  }
  if (level.mode === 'saddle') {
    return (x) => v(x.x, -x.y);
  }
  return () => v(0, 0);
}

/** @param {typeof LEVELS[number]} level */
function potentialV(level, mutable, x) {
  if (level.mode === 'potential' && level.potentialKind === 'quadraticWell') {
    const g = mutable.g;
    const k = level.k ?? 1;
    return (k / 2) * len(sub(x, g)) ** 2;
  }
  if (level.mode === 'potential' && level.potentialKind === 'doubleWell') {
    const s = level.sigma;
    const p1 = level.p1;
    const p2 = level.p2;
    return -(Math.exp(-(len(sub(x, p1)) ** 2) / (s * s)) + Math.exp(-(len(sub(x, p2)) ** 2) / (s * s)));
  }
  return 0;
}

/** Wo die grüne Zielscheibe liegt (kann vom beweglichen Anker g abweichen). */
function winTargetPoint(level, mutable) {
  if (level.mode === 'potential' && level.potentialKind === 'doubleWell' && level.winMinimum === 'p1') {
    return level.p1;
  }
  if (level.goal) return level.goal;
  if (level.mode === 'saddle') return level.goal;
  if (level.mode === 'ode') return mutable.g;
  if (level.mode === 'potential' && level.potentialKind === 'quadraticWell') return mutable.g;
  return v(0, 0);
}

function inGoal(level, mutable) {
  const x = mutable.x;
  const tp = winTargetPoint(level, mutable);
  return len(sub(x, tp)) <= GOAL_R;
}

/** Fixpunkt fürs „Ziel verfehlt“ (Ruhe am Anker ohne Treffer in der Zielzone). */
function attractorPoint(level, mutable) {
  if (level.mode === 'ode' || (level.mode === 'potential' && level.potentialKind === 'quadraticWell')) {
    return mutable.g;
  }
  return null;
}

/**
 * @param {typeof LEVELS[number]} level
 * @param {{ x: Vec2; g?: Vec2 }} mutable
 * @param {Vec2} rhsVal
 */
function shouldEndLost(level, mutable, rhsVal) {
  const x = mutable.x;
  const rhs = rhsVal;
  if (level.mode === 'potential' && level.potentialKind === 'doubleWell' && level.winMinimum === 'p1') {
    const nearP2 = len(sub(x, level.p2)) < 0.22;
    const slow = len(rhs) < SETTLE_SPEED;
    if (nearP2 && slow && !inGoal(level, mutable)) return true;
    return false;
  }
  const ap = attractorPoint(level, mutable);
  if (ap && level.goal && len(sub(level.goal, ap)) > 1e-6) {
    if (len(sub(x, ap)) < SETTLE_DIST && len(rhs) < SETTLE_SPEED && !inGoal(level, mutable)) return true;
  }
  return false;
}

function formatNum(n) {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
}

/**
 * @param {object} props
 * @param {typeof LEVELS[number]} props.level
 * @param {object} props.mutable
 */
function MathPanel({ level, mutable, playing, hStep }) {
  const tex = useMemo(() => {
    const x1 = formatNum(mutable.x.x);
    const x2 = formatNum(mutable.x.y);
    const gx = formatNum(mutable.g?.x ?? 0);
    const gy = formatNum(mutable.g?.y ?? 0);
    const k = formatNum(level.k ?? 1);

    if (level.mode === 'ode' && level.odeKind === 'linearAttractor') {
      return {
        main: katex.renderToString(
          `\\dot{\\mathbf{x}} = -${k}\\,(\\mathbf{x}-\\mathbf{g}),\\quad \\mathbf{x}=\\begin{pmatrix}${x1}\\\\${x2}\\end{pmatrix},\\quad \\mathbf{g}=\\begin{pmatrix}${gx}\\\\${gy}\\end{pmatrix}`,
          { throwOnError: false, displayMode: true }
        ),
        sub: katex.renderToString(`\\mathbf{x}(t)\\in\\mathbb{R}^2`, { throwOnError: false }),
      };
    }
    if (level.mode === 'potential' && level.potentialKind === 'quadraticWell') {
      const kk = formatNum(level.k ?? 1);
      return {
        main: katex.renderToString(
          `V(\\mathbf{x})=\\tfrac{${kk}}{2}\\|\\mathbf{x}-\\mathbf{g}\\|^2,\\quad \\dot{\\mathbf{x}}=-\\nabla V(\\mathbf{x})=-${kk}\\,(\\mathbf{x}-\\mathbf{g})`,
          { throwOnError: false, displayMode: true }
        ),
        sub: katex.renderToString(
          `\\mathbf{x}=\\begin{pmatrix}${x1}\\\\${x2}\\end{pmatrix},\\quad \\mathbf{g}=\\begin{pmatrix}${gx}\\\\${gy}\\end{pmatrix}`,
          { throwOnError: false }
        ),
      };
    }
    if (level.mode === 'potential' && level.potentialKind === 'doubleWell') {
      const s = formatNum(level.sigma);
      const p1x = formatNum(level.p1.x);
      const p1y = formatNum(level.p1.y);
      const p2x = formatNum(level.p2.x);
      const p2y = formatNum(level.p2.y);
      return {
        main: katex.renderToString(
          `V(\\mathbf{x})=-e^{-\\|\\mathbf{x}-\\mathbf{p}_1\\|^2/${s}^2}-e^{-\\|\\mathbf{x}-\\mathbf{p}_2\\|^2/${s}^2},\\quad \\dot{\\mathbf{x}}=-\\nabla V(\\mathbf{x})`,
          { throwOnError: false, displayMode: true }
        ),
        sub: katex.renderToString(
          `\\mathbf{p}_1=\\begin{pmatrix}${p1x}\\\\${p1y}\\end{pmatrix},\\quad \\mathbf{p}_2=\\begin{pmatrix}${p2x}\\\\${p2y}\\end{pmatrix},\\quad \\mathbf{x}=\\begin{pmatrix}${x1}\\\\${x2}\\end{pmatrix}`,
          { throwOnError: false }
        ),
      };
    }
    if (level.mode === 'saddle') {
      const gx = formatNum(level.goal.x);
      const gy = formatNum(level.goal.y);
      return {
        main: katex.renderToString(
          `\\dot{x}_1=x_1,\\quad \\dot{x}_2=-x_2,\\quad \\mathbf{x}=\\begin{pmatrix}${x1}\\\\${x2}\\end{pmatrix}`,
          { throwOnError: false, displayMode: true }
        ),
        sub: katex.renderToString(
          `\\text{Zielscheibe um }\\begin{pmatrix}${gx}\\\\${gy}\\end{pmatrix},\\quad r=${formatNum(GOAL_R)}`,
          { throwOnError: false }
        ),
      };
    }
    return { main: '', sub: '' };
  }, [level, mutable.x.x, mutable.x.y, mutable.g?.x, mutable.g?.y]);

  const disc = useMemo(
    () =>
      katex.renderToString(
        `h=${formatNum(hStep)}\\text{ — Zeitschritt pro RK4-Integrationsschritt}`,
        { throwOnError: false }
      ),
    [hStep]
  );

  return (
    <div class="fp-math">
      <div class="fp-math-row fp-math-main" dangerouslySetInnerHTML={{ __html: tex.main }} />
      {tex.sub && <div class="fp-math-row fp-math-sub" dangerouslySetInnerHTML={{ __html: tex.sub }} />}
      <div class="fp-math-meta">
        <span class={playing ? 'fp-dot fp-dot--on' : 'fp-dot'} aria-hidden="true" />
        {playing ? 'Simulation läuft' : 'Pause — Ziehen oder Abspielen'}
        <span class="fp-math-sep" />
        Schrittweite&nbsp;
        <span class="fp-mono">{formatNum(hStep)}</span>
        <span dangerouslySetInnerHTML={{ __html: disc }} class="fp-math-disc" />
      </div>
      <p class="fp-disclaimer">
        <strong>Rand:</strong> Der Zustand wird am sichtbaren Rand begrenzt — Trajektorien können sich dadurch leicht von
        einer unbegrenzten Integralkurve unterscheiden. Für die Lernidee reicht das; streng mathematisch wäre die Bewegung
        ohne diese Begrenzung zu betrachten.
      </p>
    </div>
  );
}

export default function FlowPuzzle() {
  const [levelIndex, setLevelIndex] = useState(0);
  const level = LEVELS[levelIndex];

  const [mutable, setMutable] = useState(() => ({
    x: { ...level.x0 },
    g: level.g ? { ...level.g } : v(0, 0),
  }));

  useEffect(() => {
    const L = LEVELS[levelIndex];
    setMutable({
      x: { ...L.x0 },
      g: L.g ? { ...L.g } : v(0, 0),
    });
    setPlaying(false);
    setWon(false);
    setLost(false);
  }, [levelIndex]);

  const [playing, setPlaying] = useState(false);
  const [won, setWon] = useState(false);
  const [lost, setLost] = useState(false);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const rhsRef = useRef(() => v(0, 0));
  const playingRef = useRef(false);
  const xSimRef = useRef(mutable.x);
  const simRafRef = useRef(0);
  const playStartMsRef = useRef(0);
  const mutableRef = useRef(mutable);
  mutableRef.current = mutable;
  playingRef.current = playing;

  useEffect(() => {
    if (!playing) xSimRef.current = mutable.x;
  }, [playing, mutable.x]);

  const rhs = useMemo(() => makeRhs(level, mutable), [level, mutable.x, mutable.g]);

  useEffect(() => {
    rhsRef.current = rhs;
  }, [rhs]);

  const worldToScreen = useCallback((ctx, p) => {
    const c = ctx.canvas;
    const m = 0.06;
    const sx = ((p.x + WORLD) / (2 * WORLD)) * (1 - 2 * m) + m;
    const sy = ((WORLD - p.y) / (2 * WORLD)) * (1 - 2 * m) + m;
    return { x: sx * c.width, y: sy * c.height };
  }, []);

  const draw = useCallback(
    (particleOverride) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const particle = particleOverride ?? mutable.x;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#07080f';
      ctx.fillRect(0, 0, w, h);

      const rhsFn = rhsRef.current;
      const mPad = 0.06;

    /* Potential heat (optional) */
    if (level.showPotential) {
      let vmin = Infinity;
      let vmax = -Infinity;
      const nx = 40;
      const ny = 40;
      for (let jj = 0; jj <= ny; jj++) {
        for (let ii = 0; ii <= nx; ii++) {
          const u = mPad + (ii / nx) * (1 - 2 * mPad);
          const vpix = mPad + (jj / ny) * (1 - 2 * mPad);
          const px = ((u - mPad) / (1 - 2 * mPad) - 0.5) * 2 * WORLD;
          const py = (0.5 - (vpix - mPad) / (1 - 2 * mPad)) * 2 * WORLD;
          const val = potentialV(level, mutable, v(px, py));
          vmin = Math.min(vmin, val);
          vmax = Math.max(vmax, val);
        }
      }
      const range = Math.max(vmax - vmin, 1e-6);
      const img = ctx.createImageData(w, h);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const u = i / w;
          const vpix = j / h;
          const px = ((u - mPad) / (1 - 2 * mPad) - 0.5) * 2 * WORLD;
          const py = (0.5 - (vpix - mPad) / (1 - 2 * mPad)) * 2 * WORLD;
          const val = potentialV(level, mutable, v(px, py));
          const t = (val - vmin) / range;
          const r = Math.floor(20 + 80 * t);
          const gch = Math.floor(30 + 60 * (1 - t));
          const b = Math.floor(80 + 120 * t);
          const idx = (j * w + i) * 4;
          img.data[idx] = r;
          img.data[idx + 1] = gch;
          img.data[idx + 2] = b;
          img.data[idx + 3] = 210;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    /* Grid field */
    const n = FIELD_GRID;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const wx = -WORLD + (2 * WORLD * i) / (n - 1);
        const wy = -WORLD + (2 * WORLD * j) / (n - 1);
        const p = v(wx, wy);
        const f = rhsFn(p);
        const Lf = len(f);
        const dir = Lf > 1e-8 ? norm(f) : v(0, 0);
        const arrowLen = Math.min(0.22, 0.08 + Lf * 0.04);
        const p1 = worldToScreen(ctx, p);
        const p2w = add(p, scale(dir, arrowLen * 3.2));
        const p2 = worldToScreen(ctx, p2w);
        ctx.beginPath();
        ctx.strokeStyle =
          level.showPotential && Lf > 0.05 ? 'rgba(255,255,255,0.22)' : 'rgba(120,200,255,0.35)';
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    const drawGoalDisk = (center) => {
      const gS = worldToScreen(ctx, center);
      const gEdge = worldToScreen(ctx, v(center.x + GOAL_R, center.y));
      const gr = Math.max(8, Math.abs(gEdge.x - gS.x));
      ctx.beginPath();
      ctx.fillStyle = 'rgba(80, 255, 160, 0.18)';
      ctx.strokeStyle = 'rgba(120, 255, 190, 0.55)';
      ctx.lineWidth = 2;
      ctx.arc(gS.x, gS.y, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    if (level.mode === 'potential' && level.potentialKind === 'doubleWell') {
      drawGoalDisk(level.p1);
      const p2s = worldToScreen(ctx, level.p2);
      const p2e = worldToScreen(ctx, v(level.p2.x + GOAL_R, level.p2.y));
      const p2r = Math.max(6, Math.abs(p2e.x - p2s.x));
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.arc(p2s.x, p2s.y, p2r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const gc = winTargetPoint(level, mutable);
      drawGoalDisk(gc);
    }

    /* Particle */
    const ps = worldToScreen(ctx, particle);
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(ps.x, ps.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* Anker g: bei ODE immer sichtbar; bei quadratischem Potential nur wenn ziehbar */
    const showGMarker =
      (level.mode === 'ode' && mutable.g) ||
      (level.mode === 'potential' && level.potentialKind === 'quadraticWell' && mutable.g && level.dragG);
    if (showGMarker) {
      const gs = worldToScreen(ctx, mutable.g);
      const r = level.mode === 'ode' && !level.dragG ? 10 : 11;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 120, 160, 0.9)';
      ctx.arc(gs.x, gs.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a0a12';
      ctx.font = 'bold 12px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('g', gs.x, gs.y + 0.5);
    }
    },
    [level, mutable, worldToScreen]
  );

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const nw = Math.max(1, Math.floor(rect.width * dpr));
      const nh = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== nw || canvas.height !== nh) {
        canvas.width = nw;
        canvas.height = nh;
        draw();
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    if (!playing) return;
    playStartMsRef.current = Date.now();
    let alive = true;
    const tick = () => {
      if (!alive || !playingRef.current) return;
      if (Date.now() - playStartMsRef.current > MAX_PLAY_MS) {
        const x = { ...xSimRef.current };
        setLost(true);
        setWon(false);
        setPlaying(false);
        draw(x);
        return;
      }
      let x = { ...xSimRef.current };
      for (let s = 0; s < MAX_STEPS_PER_FRAME; s++) {
        x = rk4Step(rhsRef.current, x, DT);
        x = clampWorld(x);
        const next = { ...mutableRef.current, x };
        const rhsAt = rhsRef.current(x);
        if (inGoal(level, next)) {
          xSimRef.current = x;
          setMutable(next);
          setWon(true);
          setLost(false);
          setPlaying(false);
          draw(x);
          return;
        }
        if (shouldEndLost(level, next, rhsAt)) {
          xSimRef.current = x;
          setMutable(next);
          setLost(true);
          setWon(false);
          setPlaying(false);
          draw(x);
          return;
        }
      }
      xSimRef.current = x;
      setMutable((m) => ({ ...m, x }));
      draw(x);
      simRafRef.current = requestAnimationFrame(tick);
    };
    simRafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(simRafRef.current);
    };
  }, [playing, levelIndex, level, draw]);

  const clientToWorld = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return v(0, 0);
    const rect = canvas.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    const v0 = (clientY - rect.top) / rect.height;
    const m = 0.06;
    const wx = ((u - m) / (1 - 2 * m) - 0.5) * 2 * WORLD;
    const wy = (0.5 - (v0 - m) / (1 - 2 * m)) * 2 * WORLD;
    return clampWorld(v(wx, wy));
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const cw = clientToWorld(e.clientX, e.clientY);
    const rg = 0.26;
    if (level.dragG && mutable.g && len(sub(cw, mutable.g)) < rg) {
      dragRef.current = 'g';
    } else if (level.dragParticle) {
      dragRef.current = 'x';
      setMutable((m) => ({ ...m, x: clampWorld(cw) }));
    } else {
      return;
    }
    e.target.setPointerCapture?.(e.pointerId);
    setPlaying(false);
    setWon(false);
    setLost(false);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const cw = clientToWorld(e.clientX, e.clientY);
    if (dragRef.current === 'x') setMutable((m) => ({ ...m, x: cw }));
    if (dragRef.current === 'g') setMutable((m) => ({ ...m, g: cw }));
    setWon(false);
    setLost(false);
  };

  const onPointerUp = (e) => {
    dragRef.current = null;
    try {
      (e.target).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const resetLevel = () => {
    setPlaying(false);
    setWon(false);
    setLost(false);
    const L = LEVELS[levelIndex];
    setMutable({
      x: { ...L.x0 },
      g: L.g ? { ...L.g } : v(0, 0),
    });
  };

  const glossaryItems = level.glossaryKeys.map((k) => ({ key: k, ...GLOSSARY[k] })).filter(Boolean);

  return (
    <div class="fp-root">
      <div class="fp-head">
        <div class="fp-level-nav">
          <button type="button" class="fp-btn" disabled={levelIndex <= 0} onClick={() => setLevelIndex((i) => i - 1)}>
            ←
          </button>
          <span class="fp-level-label">
            Block {level.series} · {level.title}
          </span>
          <button
            type="button"
            class="fp-btn"
            disabled={levelIndex >= LEVELS.length - 1}
            onClick={() => setLevelIndex((i) => i + 1)}
          >
            →
          </button>
        </div>
        <p class="fp-blurb">{level.blurb}</p>
      </div>

      <div class="fp-canvas-wrap">
        <canvas
          ref={canvasRef}
          class="fp-canvas"
          role="img"
          aria-label="Vektorfeld und Partikel — ziehen zum Bewegen"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {won && (
          <div class="fp-toast fp-toast--ok" role="status">
            Ziel erreicht
          </div>
        )}
        {lost && !won && (
          <div class="fp-toast fp-toast--miss" role="status">
            Ziel verfehlt — neu ausrichten oder zurücksetzen
          </div>
        )}
      </div>

      <div class="fp-toolbar">
        <button
          type="button"
          class="fp-btn fp-btn--primary"
          onClick={() =>
            setPlaying((p) => {
              if (!p) {
                setWon(false);
                setLost(false);
              }
              return !p;
            })
          }
        >
          {playing ? 'Pause' : 'Abspielen'}
        </button>
        <button type="button" class="fp-btn" onClick={resetLevel}>
          Zurücksetzen
        </button>
      </div>

      <MathPanel level={level} mutable={mutable} playing={playing} hStep={DT} />

      <section class="fp-learn" aria-label="Ausführliche Erklärung">
        <h2 class="fp-learn-h">Worum geht es hier?</h2>
        <p class="fp-learn-context">
          Aktuell: <strong>Block {level.series}</strong> — {level.title}
        </p>
        <div class="fp-learn-body fp-learn-body--main">
          <p>
            Genau das, was der Aufmacher beschreibt, siehst du im Bild: <strong>Pfeile</strong> = Tendenz am Ort, <strong>weiß</strong>{' '}
            = wo du startest, <strong>grün</strong> = eine Zone, die du bei der Bewegung treffen willst, <strong>rot g</strong> = der
            Ort, zu dem viele Felder „hinausziehen“ (Anker oder tiefstes Tal). Nicht um akademische Punkte geht es, sondern um die
            Idee: <em>gleiche Regel überall</em> — wie Menschen sich das für bestimmte Bewegungen in der Ebene überlegt haben.
          </p>
          <p>
            <strong>Formeln und Simulation gehören zusammen:</strong> Die <strong>Formeln unter dem Spielfeld</strong> sind{' '}
            <strong>live</strong> dieselbe Rechenregel wie die Pfeile und der wandernde Punkt — nichts ist nur Deko. Wenn Formel und
            Bild auseinanderliefen, wäre das ein Implementierungsfehler.
          </p>
          <p>
            Im Fachjargon heißt das: Der Zustand <strong>x</strong> (weißer Punkt) folgt einer <strong>autonomen
            Differentialgleichung</strong> <strong>ẋ = f(x)</strong> in der Ebene. Die Pfeile zeigen das <strong>Vektorfeld</strong>{' '}
            <strong>f</strong> — grob, wohin sich der Zustand am jeweiligen Ort „sofort“ tendiert, wenn du die Zeit anstößt.
          </p>
          <ul class="fp-learn-legend" aria-label="Legende">
            <li>
              <span class="fp-learn-dot fp-learn-dot--x" aria-hidden="true" />
              <span>
                <strong>Weiß</strong> — aktueller Zustand <strong>x</strong> (Startpunkt; ziehbar im Feld).
              </span>
            </li>
            <li>
              <span class="fp-learn-dot fp-learn-dot--goal" aria-hidden="true" />
              <span>
                <strong>Grün</strong> — <strong>Zielzone</strong> (Sieger, wenn der Punkt sie bei der Simulation erreicht). Sie ist
                absichtlich <em>nicht</em> dasselbe wie der rote Anker: der Fluss zieht oft zu <strong>g</strong>, die Aufgabe ist,
                Bahn und Zone zur Deckung zu bringen.
              </span>
            </li>
            <li>
              <span class="fp-learn-dot fp-learn-dot--g" aria-hidden="true" />
              <span>
                <strong>Rot g</strong> — Anker bzw. tiefstes Tal im quadratischen Potential (je nach Level fest oder ziehbar). Bei
                linearem Anzieher verläuft die Trajektorie auf einer <strong>Geraden</strong> von Start zu <strong>g</strong>; die
                grüne Scheibe kann danebenliegen — dann gibt es keinen Treffer, bis du startest oder <strong>g</strong> verschiebst.
              </span>
            </li>
          </ul>
          <p>
            <strong>Abspielen</strong> integriert die Gleichung numerisch (Runge–Kutta 4. Ordnung, Schrittweite wie angegeben).{' '}
            <strong>Gewinnen</strong> heißt: die Zielzone wird getroffen. <strong>Verlieren</strong> kannst du, wenn du z. B. im
            falschen Tal landest, am Anker zur Ruhe kommst ohne die Zone, oder die Zeit reicht nicht — je nach Level.
          </p>
          <p>
            <strong>Blöcke:</strong> <strong>A</strong> — lineare Vektorfelder zum Anker; <strong>B</strong> — Fluss als
            Gradientenabstieg in einem Potential (Hintergrundfarbe = grob die „Höhe“); <strong>C</strong> — Sattelpunkt, bei dem
            kleine Startänderungen die spätere Lage stark beeinflussen können.
          </p>
        </div>

        <details class="fp-learn-details">
          <summary>Mitdenken: Numerik, Rand, Begriffe</summary>
          <div class="fp-learn-body">
            <p>
              Streng wäre die Zeit <strong>kontinuierlich</strong>; der Rechner macht daraus <strong>diskrete Schritte</strong> mit
              Schrittweite <strong>h</strong>. RK4 nutzt pro Schritt mehrere Zwischenrichtungen und mittelt — bei gleichem{' '}
              <strong>h</strong> meist genauer als der einfache Eulerschritt <strong>x ← x + h f(x)</strong>.
            </p>
            <p>
              Der sichtbare Bereich ist ein <strong>Ausschnitt</strong> der Ebene; am Rand wird der Zustand begrenzt (siehe Hinweis
              unter den Formeln). Reale Trajektorien ohne Rand können sich leicht unterscheiden — für die Idee von Fluss und Ziel
              reicht der Ausschnitt.
            </p>
            <p>
              Unten im <strong>Glossar</strong> findest du einzelne Begriffe (Zustand, Vektorfeld, Gradient, …). Die Kurztexte dort
              ergänzen diese Erklärung; sie ersetzen sie nicht.
            </p>
          </div>
        </details>
      </section>

      <section class="fp-glossary" aria-label="Glossar">
        <h2 class="fp-glossary-title">Begriffe</h2>
        <ul class="fp-glossary-list">
          {glossaryItems.map((item) => (
            <li key={item.key} class="fp-gloss-item">
              <details class="fp-details">
                <summary>
                  <span class="fp-gloss-name">{item.title}</span>
                  <span class="fp-gloss-short">{item.short}</span>
                </summary>
                <p class="fp-gloss-long">{item.long}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
