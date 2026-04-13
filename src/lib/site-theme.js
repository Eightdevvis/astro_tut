/** @type {'light' | 'dark'} */
export const THEME_STORAGE_KEY = 'color-scheme';

/** @returns {'light' | 'dark'} */
export function readStoredScheme() {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
    const legacy = localStorage.getItem('theme');
    if (legacy === 'dark') return 'dark';
    if (legacy === 'ocean' || legacy === 'sunset' || legacy === 'forest' || legacy === 'purple') return 'light';
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @param {'light' | 'dark'} scheme */
export function applySchemeToDocument(scheme) {
  const dark = scheme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
  syncThemeColorMeta();
  window.dispatchEvent(new CustomEvent('site-theme-change', { detail: { scheme } }));
}

export function syncThemeColorMeta() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m) return;
  const dark = document.documentElement.classList.contains('dark');
  m.setAttribute('content', dark ? '#0a0a0c' : '#f4f1ea');
}

export function syncThemeToggleButtons() {
  const dark = document.documentElement.classList.contains('dark');
  document.querySelectorAll('[data-site-theme-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    b.setAttribute('aria-label', dark ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln');
  });
}

export function bindSiteThemeToggleDelegation() {
  if (typeof window === 'undefined' || window.__siteThemeToggleDelegation) return;
  window.__siteThemeToggleDelegation = true;
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target && /** @type {Element} */ (e.target).closest?.('[data-site-theme-toggle]');
      if (!btn) return;
      e.preventDefault();
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applySchemeToDocument(next);
      syncThemeToggleButtons();
    },
    true
  );
  const run = () => {
    syncThemeToggleButtons();
    syncThemeColorMeta();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}
