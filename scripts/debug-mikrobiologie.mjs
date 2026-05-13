#!/usr/bin/env node
/**
 * Headless-Debug fuer /minigames/mikrobiologie.
 * Startet kein Dev-Server selbst — der muss laufen (`npm run dev`).
 *
 * Auth-Cookie:
 *   `session=...` in der Umgebung als MB_SESSION exportieren, sonst
 *   redirected die Seite und wir sehen nur einen 302.
 *   In Firefox/Chrome: DevTools > Application/Storage > Cookies > localhost:4321
 *   > "session" > value kopieren.
 *
 *   MB_SESSION="ey..." node scripts/debug-mikrobiologie.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.MB_BASE || 'http://localhost:4321';
const PATH = '/minigames/mikrobiologie';
const SESSION = process.env.MB_SESSION || '';
const HEADLESS = process.env.MB_HEADED !== '1';

const url = BASE + PATH;

function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function log(kind, ...rest) {
  console.log(`[${ts()}] [${kind}]`, ...rest);
}

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext();

if (SESSION) {
  const { hostname } = new URL(BASE);
  await context.addCookies([
    {
      name: 'session',
      value: SESSION,
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  log('auth', 'session-cookie gesetzt');
} else {
  log('auth', 'KEIN session-cookie (export MB_SESSION=…) — Page wird auf / redirecten');
}

const page = await context.newPage();

page.on('console', (msg) => {
  log(`console:${msg.type()}`, msg.text());
});
page.on('pageerror', (err) => {
  log('pageerror', err.message);
  if (err.stack) console.log(err.stack);
});
page.on('requestfailed', (req) => {
  log('reqfail', req.url(), '—', req.failure()?.errorText);
});
page.on('response', (res) => {
  const status = res.status();
  if (status >= 400) log(`response:${status}`, res.url());
});

log('nav', url);
const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
log('nav:done', 'status', resp?.status(), 'final-url', page.url());

if (!page.url().includes('/minigames/mikrobiologie')) {
  log('auth', 'Nach Navigation NICHT mehr auf der Seite — vermutlich Redirect. Session-Cookie pruefen.');
  await browser.close();
  process.exit(2);
}

// Auf den Builder-Button warten und klicken
try {
  const btn = page.locator('button.mb-launch-btn');
  await btn.waitFor({ state: 'visible', timeout: 8000 });
  log('btn', 'Button sichtbar, klicke…');
  await btn.click();
} catch (err) {
  log('btn:fail', err.message);
}

// Eine Weile beobachten — gibt Ketcher Zeit zum Mounten
log('wait', '10 s lauschen…');
await page.waitForTimeout(10000);

// Debug-Log aus dem MoleculeBuilder einsammeln (steht im <details>-Block)
const debugEntries = await page.evaluate(() => {
  const list = document.querySelectorAll('.mb-debug-entry');
  return Array.from(list).map((li) => ({
    phase: li.querySelector('.mb-debug-phase')?.textContent || '',
    msg: li.querySelector('.mb-debug-msg')?.textContent || '',
    stack: li.querySelector('.mb-debug-stack')?.textContent || '',
  }));
});

log('debug-log', `${debugEntries.length} Eintraege in der UI`);
for (const e of debugEntries) {
  console.log('  •', e.phase, e.msg ? `— ${e.msg}` : '');
  if (e.stack) console.log('    stack:', e.stack.slice(0, 600));
}

// Was steckt im Editor-Panel?
const editorState = await page.evaluate(() => {
  const rectOf = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  const widthChain = (el) => {
    const out = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const s = getComputedStyle(cur);
      out.push({
        tag: cur.tagName.toLowerCase(),
        cls: cur.className?.toString?.().slice(0, 60) || '',
        id: cur.id || '',
        w: Math.round(cur.getBoundingClientRect().width),
        maxW: s.maxWidth,
        display: s.display,
        position: s.position,
      });
      cur = cur.parentElement;
    }
    return out;
  };
  const panel = document.querySelector('#mb-editor-panel');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    panelRect: rectOf(panel),
    mbRoot: rectOf(document.querySelector('.mb-root')),
    mbToolbar: rectOf(document.querySelector('.mb-toolbar')),
    hostHeight: panel?.querySelector('.mb-ketcher-host')?.getBoundingClientRect().height ?? null,
    ketcherRoot: !!document.querySelector('.Ketcher-root, .App-module_App__SUE9k'),
    chain: panel ? widthChain(panel) : null,
  };
});
log('editor-state', JSON.stringify(editorState, null, 2));

await browser.close();
log('done', 'fertig');
