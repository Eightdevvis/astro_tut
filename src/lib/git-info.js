/**
 * Liefert Git-Branch + Commit-SHA des aktuell laufenden Builds.
 *
 * Auf Vercel: `VERCEL_GIT_COMMIT_REF` (Branch) und `VERCEL_GIT_COMMIT_SHA`
 * werden vom Build automatisch gesetzt.
 *
 * Lokal: Fallback per `git`-CLI (einmalig beim Modul-Laden).
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

function compute() {
  const branch =
    readEnv('VERCEL_GIT_COMMIT_REF') ||
    readEnv('GIT_BRANCH') ||
    gitOrNull('rev-parse --abbrev-ref HEAD');
  const sha =
    readEnv('VERCEL_GIT_COMMIT_SHA') ||
    readEnv('GIT_COMMIT') ||
    gitOrNull('rev-parse HEAD');
  const shortSha = sha ? sha.slice(0, 7) : null;
  return { branch: branch || null, sha: sha || null, shortSha };
}

const cached = compute();

export function getGitInfo() {
  return cached;
}
