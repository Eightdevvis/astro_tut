/** @param {string} text */
export function linesToSteps(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label, i) => ({ id: `s-${i}`, label }));
}

/** @param {string} text */
export function parseRewards(text) {
  return text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @param {string} raw */
export function normalizeQuestId(raw) {
  let x = raw.trim().toLowerCase().replace(/\s+/g, '-');
  x = x.replace(/[^a-z0-9-_]/g, '');
  return x.slice(0, 48);
}

/**
 * @param {string[]} labels
 * @returns {{ id: string; label: string }[]}
 */
export function labelsToSteps(labels) {
  /** @type {{ id: string; label: string }[]} */
  const out = [];
  for (const raw of labels) {
    const label = String(raw).trim();
    if (!label) continue;
    out.push({ id: `s-${out.length}`, label });
  }
  return out;
}
