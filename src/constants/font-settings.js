/** Keys in site_settings; gleiche Reihenfolge wie im Super-Panel. */
export const FONT_SETTING_KEYS = [
  'font_body_family',
  'font_body_weight',
  'font_body_weight_bold',
  'font_nav_family',
  'font_menu_family',
  'font_hero_family',
  'font_quote_family',
];

export const FONT_FAMILY_KEYS = FONT_SETTING_KEYS.filter((k) => k.endsWith('_family'));
export const FONT_WEIGHT_KEYS = FONT_SETTING_KEYS.filter((k) => k.includes('weight'));

export const FONT_SETTING_LABELS = {
  font_body_family: 'Body: Schriftfamilie',
  font_body_weight: 'Body: Schriftstärke (normal)',
  font_body_weight_bold: 'Body: Schriftstärke (fett)',
  font_nav_family: 'Header / Navigation',
  font_menu_family: 'Menü-Button (Hamburger)',
  font_hero_family: 'Start: großer Titel (SaSh)',
  font_quote_family: 'Zitat-Seite: Überschrift',
};
