import { useMemo } from 'preact/hooks';

// tier: 'none' | 'confetti' | 'strong' | 'gold' — siehe src/lib/scoring-scale.js
export default function ArchaeaLipidsConfetti({ tier, runId }) {
  // runId aendert sich pro Trigger (z. B. Date.now()); damit feuert die
  // Animation neu, auch wenn dasselbe Tier nochmal getroffen wird.
  const particles = useMemo(() => {
    if (tier === 'none') return [];
    const baseColors = ['#e0455a', '#3d8a59', '#3768a5', '#d8a000', '#9333ea', '#ec4899'];
    const goldColors = ['#ffd700', '#f4c842', '#f7e07c'];
    const count =
      tier === 'gold' ? 110 : tier === 'strong' ? 70 : 40;
    const goldCount = tier === 'gold' ? 30 : 0;
    return Array.from({ length: count }, (_, i) => {
      const isGold = i < goldCount;
      const palette = isGold ? goldColors : baseColors;
      return {
        key: `${runId}-${i}`,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2.5 + Math.random() * 2,
        color: palette[i % palette.length],
        size: 6 + Math.random() * 8,
        rotateEnd: Math.random() * 720 - 360,
        translateX: (Math.random() - 0.5) * 80,
      };
    });
  }, [tier, runId]);

  if (tier === 'none' || particles.length === 0) return null;

  return (
    <div className="alg-confetti-root" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.key}
          className="alg-confetti-particle"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: p.color,
            width: `${p.size}px`,
            height: `${p.size}px`,
            '--alg-rotate-end': `${p.rotateEnd}deg`,
            '--alg-tx': `${p.translateX}px`,
          }}
        />
      ))}
      <style>{`
        .alg-confetti-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 200;
        }
        .alg-confetti-particle {
          position: absolute;
          top: -12px;
          display: block;
          border-radius: 2px;
          will-change: transform, opacity;
          animation-name: alg-confetti-fall;
          animation-timing-function: cubic-bezier(0.22, 0.68, 0.46, 1);
          animation-fill-mode: forwards;
        }
        @keyframes alg-confetti-fall {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          80%  { opacity: 1; }
          100% {
            transform: translate(var(--alg-tx, 0px), 105vh) rotate(var(--alg-rotate-end, 360deg));
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
