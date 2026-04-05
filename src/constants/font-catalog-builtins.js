/**
 * Eingebaute Schriften (Dateien unter /public/fonts — siehe global.css @font-face).
 * value = gespeicherter site_settings-Wert (wie bisher, ohne CSS-Anführungszeichen).
 */
export const BUILTIN_FILE_FONTS = [
  { value: 'Black Spiral', label: 'Black Spiral', path: '/fonts/black spiral.ttf' },
  { value: 'CrazyCurlz', label: 'CrazyCurlz', path: '/fonts/CrazyCurlz.ttf' },
  { value: 'North Point', label: 'North Point', path: '/fonts/North point.ttf' },
  { value: 'Protest Demo', label: 'Protest Demo', path: '/fonts/Protest Demo.ttf' },
];

/** System-/Webfonts ohne eigene Datei (Vorschau nutzt Systeminstallation). */
export const SYSTEM_FONT_STACKS = [
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
  { value: 'Impact, Haettenschweiler, sans-serif', label: 'Impact' },
];

export const WEIGHT_OPTIONS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
