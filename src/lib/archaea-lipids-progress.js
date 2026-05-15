// LocalStorage-Persistenz fuer das Minigame "Archaea: Membran: Lipide".
// Liest/schreibt im Browser. SSR-safe (gibt leeren Default zurueck).
//
// Datenmodell:
//   {
//     l1: { [lipidId]: { correct: boolean } },
//     l2: { [lipidId]: { bestScore: number } },  // 0..100
//   }
//
// Punkteverteilung fuer Gesamt-Karten-Prozent:
//   L1: 50 % gesamt -> pro korrekt-getipptem Lipid: 50/3 % (~16.67).
//   L2: 50 % gesamt -> pro Lipid: bestScore/100 * 50/3 %.

import { ARCHAEA_LIPIDS } from './archaea-lipids.js';

const STORAGE_KEY = 'mikrobio:archaea-lipide:v1';

export function loadProgress() {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* localStorage voll oder verboten — egal */
  }
}

export function markLevel1(lipidId, correct) {
  const p = loadProgress();
  const prev = p.l1[lipidId] || { correct: false };
  // Nicht herunterstufen: "einmal richtig getippt" bleibt richtig.
  p.l1[lipidId] = { correct: prev.correct || Boolean(correct) };
  saveProgress(p);
  return p;
}

export function markLevel2(lipidId, score) {
  const p = loadProgress();
  const prevBest = p.l2[lipidId]?.bestScore ?? 0;
  p.l2[lipidId] = { bestScore: Math.max(prevBest, Math.round(score)) };
  saveProgress(p);
  return p;
}

export function totalScore(progress) {
  const lipidCount = ARCHAEA_LIPIDS.length;
  if (lipidCount === 0) return 0;
  const perLipidL1 = 50 / lipidCount;
  const perLipidL2 = 50 / lipidCount;
  let total = 0;
  for (const lipid of ARCHAEA_LIPIDS) {
    if (progress.l1[lipid.id]?.correct) total += perLipidL1;
    const l2 = progress.l2[lipid.id]?.bestScore ?? 0;
    total += (l2 / 100) * perLipidL2;
  }
  return Math.round(total);
}

export function level1Percent(progress) {
  const lipidCount = ARCHAEA_LIPIDS.length;
  const correct = ARCHAEA_LIPIDS.filter((l) => progress.l1[l.id]?.correct).length;
  return Math.round((correct / lipidCount) * 100);
}

export function level2Percent(progress) {
  const lipidCount = ARCHAEA_LIPIDS.length;
  const sum = ARCHAEA_LIPIDS.reduce(
    (acc, l) => acc + (progress.l2[l.id]?.bestScore ?? 0),
    0,
  );
  return Math.round(sum / lipidCount);
}

// Merge zweier Progress-Objekte (z. B. local vs. server). Pro Lipid:
// - l1.correct -> OR (einmal richtig bleibt richtig)
// - l2.bestScore -> max
export function mergeProgress(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  const l1 = {};
  const l1Keys = new Set([...Object.keys(na.l1), ...Object.keys(nb.l1)]);
  for (const k of l1Keys) {
    l1[k] = { correct: Boolean(na.l1[k]?.correct || nb.l1[k]?.correct) };
  }
  const l2 = {};
  const l2Keys = new Set([...Object.keys(na.l2), ...Object.keys(nb.l2)]);
  for (const k of l2Keys) {
    const ax = Math.round(na.l2[k]?.bestScore ?? 0);
    const bx = Math.round(nb.l2[k]?.bestScore ?? 0);
    l2[k] = { bestScore: Math.max(ax, bx) };
  }
  return { l1, l2 };
}

export const GAME_ID = 'archaea-lipide';

function emptyProgress() {
  return { l1: {}, l2: {} };
}

function normalize(raw) {
  return {
    l1: raw?.l1 && typeof raw.l1 === 'object' ? raw.l1 : {},
    l2: raw?.l2 && typeof raw.l2 === 'object' ? raw.l2 : {},
  };
}
