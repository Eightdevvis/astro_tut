import { BUILTIN_FILE_FONTS, SYSTEM_FONT_STACKS, WEIGHT_OPTIONS } from '../constants/font-catalog-builtins.js';
import { previewFamilyForValue } from '../constants/font-preview-helpers.js';
import { listCustomFontsMeta } from './custom-fonts.js';

/**
 * @returns {Promise<{ options: Array<{ value: string, label: string, previewFamily: string, kind: string, id?: number }>, weightOptions: string[] }>}
 */
export async function buildFontCatalog() {
  const custom = await listCustomFontsMeta();
  const options = [
    { value: '', label: '(Theme-Standard)', previewFamily: 'inherit', kind: 'default' },
    ...BUILTIN_FILE_FONTS.map((f) => ({
      value: f.value,
      label: f.label,
      previewFamily: previewFamilyForValue(f.value),
      kind: 'builtin',
    })),
    ...SYSTEM_FONT_STACKS.map((f) => ({
      value: f.value,
      label: `System: ${f.label}`,
      previewFamily: f.value,
      kind: 'system',
    })),
    ...custom.map((c) => ({
      value: c.family_name,
      label: `${c.family_name} (Upload)`,
      previewFamily: previewFamilyForValue(c.family_name),
      kind: 'custom',
      id: c.id,
    })),
  ];
  return { options, weightOptions: WEIGHT_OPTIONS };
}

export async function getCustomFontFacesCss() {
  const rows = await listCustomFontsMeta();
  if (rows.length === 0) return '';
  const parts = [];
  for (const row of rows) {
    const fmt = row.format_hint || 'truetype';
    const url = `/api/fonts/${row.id}`;
    parts.push(
      `@font-face{font-family:${JSON.stringify(row.family_name)};src:url(${JSON.stringify(url)}) format(${JSON.stringify(fmt)});font-weight:normal;font-style:normal;}`
    );
  }
  return parts.join('');
}
