/** CSS font-family für style={{ fontFamily }} auf Optionen (Vorschau). */
export function previewFamilyForValue(value) {
  if (!value || !String(value).trim()) return 'inherit';
  const v = String(value).trim();
  if (v.includes(',')) return v;
  if (/^['"].*['"]$/.test(v)) return v;
  return JSON.stringify(v);
}
