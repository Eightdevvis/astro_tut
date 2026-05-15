// Standard-Bewertungsskala fuer Score-basierte Minigames.
// Konvention projektweit; bei Aenderungen `memory/scoring-scale.mdc` mitpflegen.
//
// Tiers (Score in %):
//   >= 100 -> 'gold'      : Konfetti + zusaetzliches goldenes Konfetti on-top
//   >=  95 -> 'strong'    : Konfetti deutlich stark
//   >=  85 -> 'confetti'  : freundliches Konfetti
//    < 85  -> 'none'      : keine Animation, X-Feedback

export const SCORE_TIERS = Object.freeze({
  CONFETTI: 85,
  STRONG: 95,
  GOLD: 100,
});

export function tierFromScore(score) {
  if (score >= SCORE_TIERS.GOLD) return 'gold';
  if (score >= SCORE_TIERS.STRONG) return 'strong';
  if (score >= SCORE_TIERS.CONFETTI) return 'confetti';
  return 'none';
}

export function isPassing(score) {
  return score >= SCORE_TIERS.CONFETTI;
}
