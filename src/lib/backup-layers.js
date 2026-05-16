/**
 * Single-Source-of-Truth fuer die Backup-Schichten + Effekt-Achsen,
 * die im Tresor-UI und im Datenschutz-Details-Tab gerendert werden.
 *
 * Effekt-Werte sind freier als bei den Privacy-Toggles (nicht nur +/-),
 * weil "Speicher klein/mittel/gross" oder "sofort/verzoegert/on-demand"
 * mehr Skalen brauchen. Renderer zeigt Wert direkt an.
 */

export const BACKUP_AXES = [
  { id: 'crash',          label: 'Ueberlebt Browser-Crash' },
  { id: 'accidental',     label: 'Ueberlebt versehentliches Loeschen' },
  { id: 'serverLoss',     label: 'Ueberlebt Server-Datenverlust' },
  { id: 'accountLoss',    label: 'Ueberlebt Account-Verlust' },
  { id: 'storage',        label: 'Speicherverbrauch' },
  { id: 'externalNeeded', label: 'Externes Konto noetig' },
  { id: 'when',           label: 'Schreibt' },
  { id: 'fileable',       label: 'Als Datei abrufbar' },
];

// 'OK' = schuetzt, '-' = schuetzt nicht
export const LAYERS = [
  {
    id: 'browser_draft',
    label: 'Browser-Draft',
    short: 'Beim Tippen sofort in localStorage. Ueberlebt Browser-Crash, Tab-Schliessen, Stromausfall. Geht verloren, wenn du den Browser wechselst oder Cache loeschst.',
    alwaysOn: true,
    effects: {
      crash: 'OK', accidental: '-', serverLoss: '-', accountLoss: '-',
      storage: 'klein', externalNeeded: 'nein', when: 'sofort', fileable: 'nein',
    },
  },
  {
    id: 'server_draft',
    label: 'Server-Draft',
    short: 'Debounced 2.5 s nach jedem Tippen an den Server (blog_post_drafts). Eine Reihe pro (User, Post). Ueberlebt Browser-Crash UND Geraetewechsel.',
    alwaysOn: true,
    effects: {
      crash: 'OK', accidental: '-', serverLoss: '-', accountLoss: '-',
      storage: 'klein', externalNeeded: 'nein', when: 'verzoegert', fileable: 'nein',
    },
  },
  {
    id: 'revisions',
    label: 'Versionshistorie',
    short: 'Jeder echte Save legt vorher den aktuellen DB-Stand als Revision ab (blog_post_revisions). Du kannst alte Versionen ansehen und wiederherstellen.',
    alwaysOn: true,
    effects: {
      crash: '-', accidental: 'OK', serverLoss: '-', accountLoss: '-',
      storage: 'mittel', externalNeeded: 'nein', when: 'sofort', fileable: 'nein',
    },
  },
  {
    id: 'trash',
    label: 'Papierkorb',
    short: 'Loeschen ist nur soft (deleted_at gesetzt). Geloeschte Posts liegen 30 Tage im Papierkorb und sind wiederherstellbar.',
    alwaysOn: true,
    effects: {
      crash: '-', accidental: 'OK', serverLoss: '-', accountLoss: '-',
      storage: 'klein', externalNeeded: 'nein', when: 'sofort', fileable: 'nein',
    },
  },
  {
    id: 'export',
    label: 'Manueller Export',
    short: 'Knopf in den Settings: lade alle deine Posts + Revisionen als JSON-Datei runter. Eigene Off-Site-Kopie auf deinem Geraet.',
    alwaysOn: false,
    effects: {
      crash: '-', accidental: 'OK', serverLoss: 'OK', accountLoss: 'OK',
      storage: 'klein', externalNeeded: 'nein', when: 'on-demand', fileable: 'OK',
    },
  },
  {
    id: 'webhook_mirror',
    label: 'Externer Mirror',
    short: 'Optional: jedes Save POSTet zusaetzlich an eine von dir hinterlegte URL (z. B. ein eigener Endpoint oder Webhook-Service). Echtes Off-Site-Backup, immer aktuell.',
    alwaysOn: false,
    effects: {
      crash: '-', accidental: 'OK', serverLoss: 'OK', accountLoss: 'OK',
      storage: 'klein', externalNeeded: 'ja', when: 'verzoegert', fileable: '-',
    },
  },
];
