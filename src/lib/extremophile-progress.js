// LocalStorage-Persistenz fuer das Minigame "Extremophile".
// Speichert pro (Kategorie, Frage), ob der User die Frage **jemals** richtig
// beantwortet hat ("ever correct"). Einmal richtig bleibt richtig — damit
// der Card-Fortschritt monoton waechst und nicht durch Replays sinkt.

import { CATEGORIES, QUESTIONS, totalPossibleCorrect } from './extremophile.js';

const STORAGE_KEY = 'mikrobio:extremophile:v1';

export function loadProgress() {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    return normalize(JSON.parse(raw));
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* ignore */
  }
}

export function markCorrect(categoryId, questionId) {
  const p = loadProgress();
  if (!p.ev[categoryId]) p.ev[categoryId] = {};
  p.ev[categoryId][questionId] = true;
  saveProgress(p);
  return p;
}

export function totalCorrect(progress) {
  let n = 0;
  for (const cat of CATEGORIES) {
    const ev = progress.ev[cat.id] || {};
    for (const q of QUESTIONS) {
      if (ev[q.id]) n += 1;
    }
  }
  return n;
}

export function totalPercent(progress) {
  const max = totalPossibleCorrect();
  if (max === 0) return 0;
  return Math.round((totalCorrect(progress) / max) * 100);
}

export function categoryComplete(progress, categoryId) {
  const ev = progress.ev[categoryId] || {};
  return QUESTIONS.every((q) => ev[q.id]);
}

function emptyProgress() {
  return { ev: {} };
}

function normalize(raw) {
  return { ev: raw?.ev && typeof raw.ev === 'object' ? raw.ev : {} };
}
