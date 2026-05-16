/**
 * Liefert Git-Branch + Commit-SHA + Commit-Historie des aktuell laufenden Builds.
 *
 * Quelle: `__GIT_SNAPSHOT__` — in `astro.config.mjs` via Vite-`define` beim
 * Config-Load eingesammelt (Build-Zeit). Vercel-Runtime hat kein `.git`,
 * deshalb muss das Snapshot inline ins Bundle.
 *
 * Felder: `branch`, `sha`, `shortSha`, `repoUrl`, `history[]` (jeweils
 * `{ sha, shortSha, subject, relDate }`, absteigend nach Zeit).
 *
 * Wird in `Nav2.astro` fuer den Superuser-Branch-Badge benutzt.
 */

import { execSync } from 'node:child_process';

function readEnv(name) {
  try {
    const v = import.meta.env?.[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    /* import.meta.env evtl. nicht verfuegbar */
  }
  const v2 = process.env?.[name];
  if (typeof v2 === 'string' && v2.trim()) return v2.trim();
  return null;
}

function gitOrNull(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

function fromSnapshot() {
  try {
    // eslint-disable-next-line no-undef
    const snap = typeof __GIT_SNAPSHOT__ !== 'undefined' ? __GIT_SNAPSHOT__ : null;
    if (snap && typeof snap === 'object') return snap;
  } catch {
    /* nicht definiert */
  }
  return null;
}

function compute() {
  const snap = fromSnapshot();
  const branch =
    readEnv('VERCEL_GIT_COMMIT_REF') ||
    readEnv('GIT_BRANCH') ||
    snap?.branch ||
    gitOrNull('rev-parse --abbrev-ref HEAD') ||
    null;
  const sha =
    readEnv('VERCEL_GIT_COMMIT_SHA') ||
    readEnv('GIT_COMMIT') ||
    snap?.sha ||
    gitOrNull('rev-parse HEAD') ||
    null;
  const shortSha = sha ? sha.slice(0, 7) : null;

  let repoUrl = snap?.repoUrl || '';
  if (!repoUrl) {
    const owner = readEnv('VERCEL_GIT_REPO_OWNER');
    const slug = readEnv('VERCEL_GIT_REPO_SLUG');
    if (owner && slug) repoUrl = `https://github.com/${owner}/${slug}`;
  }
  if (!repoUrl) {
    const origin = gitOrNull('config --get remote.origin.url');
    const m = origin && origin.match(/github\.com[:/]+([^/]+)\/([^/.]+?)(?:\.git)?$/i);
    if (m) repoUrl = `https://github.com/${m[1]}/${m[2]}`;
  }

  const historySrc = Array.isArray(snap?.history) && snap.history.length
    ? snap.history
    : (() => {
        const raw = gitOrNull(
          "log -n 25 --pretty=format:%H%x1f%s%x1f%ar%x1e"
        );
        if (!raw) return [];
        return raw
          .split('\x1e')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [h, s, r] = line.split('\x1f');
            return { sha: h || '', subject: s || '', relDate: r || '' };
          });
      })();

  const history = historySrc.map((c) => ({
    sha: c.sha,
    shortSha: c.sha ? c.sha.slice(0, 7) : '',
    subject: c.subject,
    relDate: c.relDate,
  }));

  return {
    branch: branch || null,
    sha: sha || null,
    shortSha,
    repoUrl: repoUrl || null,
    history,
  };
}

const cached = compute();

export function getGitInfo() {
  return cached;
}
