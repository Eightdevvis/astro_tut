import { getDb, ensureDbSchema } from './db.js';
import { FONT_SETTING_KEYS } from '../constants/font-settings.js';

export { FONT_SETTING_KEYS } from '../constants/font-settings.js';
export { FONT_SETTING_LABELS } from '../constants/font-settings.js';

const KEY_TO_CSS_VAR = {
  font_body_family: '--font-family',
  font_body_weight: '--font-weight',
  font_body_weight_bold: '--font-weight-bold',
  font_nav_family: '--font-nav',
  font_menu_family: '--font-menu',
  font_hero_family: '--font-hero',
  font_quote_family: '--font-quote',
};

const THEME_HTML_SELECTORS =
  'html, html.dark, html.ocean, html.sunset, html.forest, html.purple';

/**
 * @returns {Promise<Record<string, string>>}
 */
export async function getAllSiteFontSettings() {
  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT setting_key, value FROM site_settings WHERE setting_key IN (' +
      FONT_SETTING_KEYS.map(() => '?').join(', ') +
      ')',
    args: FONT_SETTING_KEYS,
  });
  const out = {};
  for (const row of result.rows) {
    out[row.setting_key] = row.value;
  }
  return out;
}

/**
 * @param {Record<string, string | undefined | null>} updates Nur gesetzte Keys werden geschrieben; leerer String löscht.
 */
export async function saveSiteFontSettings(updates) {
  await ensureDbSchema();
  const db = getDb();
  for (const key of FONT_SETTING_KEYS) {
    if (!(key in updates)) continue;
    const v = updates[key];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === '') {
      await db.execute({ sql: 'DELETE FROM site_settings WHERE setting_key = ?', args: [key] });
    } else {
      await db.execute({
        sql: 'INSERT INTO site_settings (setting_key, value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value',
        args: [key, s],
      });
    }
  }
}

/**
 * Vollständiges <style>-Innere oder leerer String, wenn keine Overrides.
 */
export async function getFontOverrideStyleContent() {
  const settings = await getAllSiteFontSettings();
  const declarations = [];
  for (const key of FONT_SETTING_KEYS) {
    const val = settings[key];
    if (!val || !val.trim()) continue;
    const cssVar = KEY_TO_CSS_VAR[key];
    if (!cssVar) continue;
    if (key.includes('weight')) {
      declarations.push(`  ${cssVar}: ${val.trim()};`);
    } else {
      declarations.push(`  ${cssVar}: ${cssQuoteFont(val.trim())};`);
    }
  }
  if (declarations.length === 0) return '';
  return `${THEME_HTML_SELECTORS} {\n${declarations.join('\n')}\n}`;
}

function cssQuoteFont(s) {
  if (/^["'].*["']$/.test(s)) return s;
  return JSON.stringify(s);
}
