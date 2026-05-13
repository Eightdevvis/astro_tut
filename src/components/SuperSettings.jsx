import { useState, useEffect, useRef } from 'preact/hooks';
import {
  FONT_SETTING_LABELS,
  FONT_FAMILY_KEYS,
  FONT_WEIGHT_KEYS,
} from '../constants/font-settings.js';
import { previewFamilyForValue } from '../constants/font-preview-helpers.js';
import { RPG_ITEM_CATEGORY_IDS } from '../lib/rpg-item-categories.js';
import { questmakerCatalogToDisplayMap } from '../lib/rpg-questmaker-sync.js';

const RPG_QUESTMAKER_CATALOG_EVENT = 'rpg-questmaker-catalog-updated';

/** Gleicher Wert wie SUPER_PERMISSION in permissions.js — hier lokal, damit das Client-Bundle kein db.js lädt. */
const SUPER_PERM = 'super_access';

/** @param {string[] | undefined} perms @param {string} p */
function effectivePerm(perms, p) {
  const arr = perms || [];
  if (p === SUPER_PERM) return arr.includes(SUPER_PERM);
  return arr.includes(SUPER_PERM) || arr.includes(p);
}

/**
 * Spiegelt die Backend-Logik aus permissions.js#hasPermission im Frontend,
 * damit optimistic Updates die effektive Permission-Liste eines Users
 * neu berechnen koennen, ohne den Panel-Endpoint zu pollen.
 */
function deriveEffectivePermissions(states, globalList, knownList) {
  const out = [];
  const supState = states?.[SUPER_PERM] ?? null;
  const supGlobal = globalList.includes(SUPER_PERM);
  for (const p of knownList) {
    const own = states?.[p] ?? null;
    if (own === 'granted') {
      out.push(p);
      continue;
    }
    if (own === 'revoked') continue;
    if (p !== SUPER_PERM) {
      if (supState === 'granted') {
        out.push(p);
        continue;
      }
      if (supState !== 'revoked' && supGlobal) {
        out.push(p);
        continue;
      }
    }
    if (globalList.includes(p)) out.push(p);
  }
  return out;
}

function applyUserPermissionToggle(user, permission, nextHas, globalList, knownList) {
  const ns = { ...(user?.permissionStates || {}) };
  const globallyActive = globalList.includes(permission);
  if (nextHas) {
    if (globallyActive) delete ns[permission];
    else ns[permission] = 'granted';
  } else {
    if (globallyActive) ns[permission] = 'revoked';
    else delete ns[permission];
  }
  return {
    ...user,
    permissionStates: ns,
    permissions: deriveEffectivePermissions(ns, globalList, knownList),
  };
}

const box = {
  width: '100%',
  padding: '0 1rem 3rem',
  boxSizing: 'border-box',
};

const panelLayout = {
  display: 'grid',
  gridTemplateColumns: '220px minmax(0, 1fr)',
  gap: '1.2rem',
  alignItems: 'start',
};

const panelContent = {
  gridColumn: '2 / 3',
  minWidth: 0,
};

const menuBox = {
  position: 'fixed',
  top: 'calc(var(--nav-strip-h) + 1rem)',
  left: '1rem',
  width: '220px',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.65)',
  padding: '0.7rem',
  maxHeight: 'calc(100vh - var(--nav-strip-h) - 2rem)',
  overflowY: 'auto',
  zIndex: 5,
};

const menuBtn = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'transparent',
  padding: '0.45rem 0.55rem',
  cursor: 'pointer',
  fontSize: '0.86rem',
  lineHeight: 1.2,
};

const menuBtnActive = {
  background: 'rgba(0,0,0,0.08)',
  borderColor: 'rgba(0,0,0,0.16)',
  fontWeight: 600,
};

const section = {
  marginBottom: '2.5rem',
};

const h2 = {
  fontSize: '1.1rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: '1rem',
  opacity: 0.85,
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};

const thtd = {
  border: '1px solid rgba(0,0,0,0.15)',
  padding: '8px 10px',
  textAlign: 'left',
};

const inputRow = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 14,
};

const labelStyle = {
  fontSize: '0.75rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  opacity: 0.75,
};

const selectStyle = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.2)',
  fontSize: '1rem',
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: '100%',
  background: 'rgba(255,255,255,0.92)',
};

const btnPrimary = {
  padding: '10px 18px',
  borderRadius: 6,
  border: 'none',
  background: 'rgba(0,0,0,0.75)',
  color: '#fff',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
};

const errStyle = { color: 'crimson', marginBottom: 12, fontSize: '0.9rem' };
const okStyle = { color: 'seagreen', marginBottom: 12, fontSize: '0.9rem' };

/**
 * Composite-Preview fuer eine Liste von Graffiti-Tiles. Malt die Tiles
 * auf ein Canvas, skaliert auf die Preview-Breite. Position via (x, y) im
 * Tile-Grid; Tile-Kantenlaenge = tileSize CSS-px im Originalcanvas.
 */
function GraffitiTilePreview({ tiles, tileSize }) {
  const canvasRef = useRef(null);
  const previewWidth = 360;
  const previewMaxHeight = 240;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!Array.isArray(tiles) || tiles.length === 0) {
      canvas.width = previewWidth;
      canvas.height = 80;
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      const x = Number(t.x);
      const y = Number(t.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) {
      canvas.width = previewWidth;
      canvas.height = 80;
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const scale = Math.min(previewWidth / (cols * tileSize), previewMaxHeight / (rows * tileSize));
    canvas.width = Math.max(1, Math.round(cols * tileSize * scale));
    canvas.height = Math.max(1, Math.round(rows * tileSize * scale));

    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;

    let cancelled = false;
    Promise.all(
      tiles.map(
        (t) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ img, x: t.x, y: t.y });
            img.onerror = () => resolve(null);
            img.src = `data:image/png;base64,${t.pngBase64}`;
          })
      )
    ).then((loaded) => {
      if (cancelled) return;
      for (const entry of loaded) {
        if (!entry) continue;
        const dx = (entry.x - minX) * tileSize * scale;
        const dy = (entry.y - minY) * tileSize * scale;
        const dw = tileSize * scale;
        const dh = tileSize * scale;
        ctx.drawImage(entry.img, dx, dy, dw, dh);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tiles, tileSize]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: previewWidth,
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.12)',
        background: 'rgba(0,0,0,0.04)',
        display: 'block',
      }}
    />
  );
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

function mergeCatalogOptions(saved, options) {
  if (saved == null || saved === '') return options;
  const s = String(saved);
  const found = options.some((o) => o.value === s);
  if (found) return options;
  return [
    ...options,
    {
      value: s,
      label: `${s} (aktuell)`,
      previewFamily: previewFamilyForValue(s),
      kind: 'legacy',
    },
  ];
}

export default function SuperSettings() {
  const [activeSection, setActiveSection] = useState('notes');
  const [users, setUsers] = useState([]);
  const [knownPermissions, setKnownPermissions] = useState([]);
  const [globalPermissions, setGlobalPermissions] = useState([]);
  const [permissionWarnings, setPermissionWarnings] = useState([]);
  const [fonts, setFonts] = useState(() => {
    const o = {};
    for (const k of [...FONT_FAMILY_KEYS, ...FONT_WEIGHT_KEYS]) o[k] = '';
    return o;
  });
  const [fontCatalog, setFontCatalog] = useState({ options: [], weightOptions: [] });
  const [fontPreviewCss, setFontPreviewCss] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [testerBugReports, setTesterBugReports] = useState([]);
  const [deleteBugBusyId, setDeleteBugBusyId] = useState(null);
  const [testerUiEnabled, setTesterUiEnabled] = useState(true);
  const [testerUiBusy, setTesterUiBusy] = useState(false);
  const [testerUiMsg, setTesterUiMsg] = useState('');
  const [permBusy, setPermBusy] = useState(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [qmItems, setQmItems] = useState([]);
  const [qmMsg, setQmMsg] = useState('');
  const [qmBusy, setQmBusy] = useState(false);
  const [rpgNormMsg, setRpgNormMsg] = useState('');
  const [rpgNormBusy, setRpgNormBusy] = useState(false);
  const [feedPolicy, setFeedPolicy] = useState({ allowlist: [], blocklist: [] });
  const [fpKind, setFpKind] = useState('host_suffix');
  const [fpValue, setFpValue] = useState('');
  const [fpCategory, setFpCategory] = useState('');
  const [fpTier, setFpTier] = useState(2);
  const [fpBlock, setFpBlock] = useState('');
  const [fpMsg, setFpMsg] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [graffitiRows, setGraffitiRows] = useState([]);
  const [graffitiBusyId, setGraffitiBusyId] = useState(null);
  const [graffitiTileSize, setGraffitiTileSize] = useState(512);

  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [bugsLoaded, setBugsLoaded] = useState(false);
  const [qmLoaded, setQmLoaded] = useState(false);

  const [notesValue, setNotesValue] = useState('');
  const [notesHistory, setNotesHistory] = useState([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesMsg, setNotesMsg] = useState('');
  const [notesHistoryOpen, setNotesHistoryOpen] = useState(false);

  const [siteItems, setSiteItems] = useState([]);
  const [siteItemsLoaded, setSiteItemsLoaded] = useState(false);
  const [siteItemsBusy, setSiteItemsBusy] = useState(false);
  const [siteItemsMsg, setSiteItemsMsg] = useState('');

  function loadPanel() {
    return fetch('/api/admin/panel', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
        return data;
      })
      .then((data) => {
        setUsers(data.users || []);
        setKnownPermissions(data.knownPermissions || []);
        setGlobalPermissions(Array.isArray(data.globalPermissions) ? data.globalPermissions : []);
        setPermissionWarnings(Array.isArray(data.permissionWarnings) ? data.permissionWarnings : []);
        setTesterUiEnabled(Boolean(data.testerUiEnabled));
      });
  }

  async function loadFontsPayload() {
    if (fontsLoaded) return;
    try {
      const res = await fetch('/api/admin/panel-fonts', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Fonts laden fehlgeschlagen');
      setFontCatalog(data.fontCatalog || { options: [], weightOptions: [] });
      setFontPreviewCss(data.fontPreviewCss || '');
      const next = {};
      for (const k of [...FONT_FAMILY_KEYS, ...FONT_WEIGHT_KEYS]) {
        next[k] = data.fonts && data.fonts[k] != null ? String(data.fonts[k]) : '';
      }
      setFonts(next);
      setFontsLoaded(true);
    } catch (e) {
      setError(e?.message || 'Fonts laden fehlgeschlagen');
    }
  }

  async function loadTesterBugsPayload() {
    if (bugsLoaded) return;
    try {
      const res = await fetch('/api/admin/panel-tester-bugs', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Bug-Reports laden fehlgeschlagen');
      setTesterBugReports(data.testerBugReports || []);
      setBugsLoaded(true);
    } catch (e) {
      setError(e?.message || 'Bug-Reports laden fehlgeschlagen');
    }
  }

  async function loadNotesPayload() {
    if (notesLoaded) return;
    setNotesLoading(true);
    try {
      const res = await fetch('/api/admin/super-notes', { credentials: 'same-origin', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Notizen laden fehlgeschlagen');
      setNotesValue(typeof data?.note === 'string' ? data.note : '');
      setNotesHistory(Array.isArray(data?.history) ? data.history : []);
      setNotesLoaded(true);
    } catch (e) {
      setError(e?.message || 'Notizen laden fehlgeschlagen');
    } finally {
      setNotesLoading(false);
    }
  }

  async function saveNotes(e) {
    e?.preventDefault?.();
    setNotesMsg('');
    setError('');
    setNotesSaving(true);
    try {
      const res = await fetch('/api/admin/super-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ note: notesValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Notizen speichern fehlgeschlagen');
      setNotesValue(typeof data?.note === 'string' ? data.note : notesValue);
      setNotesHistory(Array.isArray(data?.history) ? data.history : []);
      setNotesMsg('Notizen gespeichert.');
    } catch (err) {
      setError(err?.message || 'Notizen speichern fehlgeschlagen');
    } finally {
      setNotesSaving(false);
    }
  }

  async function loadSiteItemsPayload() {
    if (siteItemsLoaded) return;
    try {
      const res = await fetch('/api/admin/site-items', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Site-Objekt-Katalog laden');
      const rows = Array.isArray(data.items) ? data.items : [];
      setSiteItems(
        rows.map((r, i) => ({
          id: String(r.id ?? ''),
          kind: String(r.kind ?? ''),
          variant: String(r.variant ?? ''),
          name: String(r.name ?? ''),
          description: String(r.description ?? ''),
          behavior: String(r.behavior ?? 'none'),
          configText: JSON.stringify(r.config ?? {}, null, 0),
          enabled: Number(r.enabled ?? 1) ? 1 : 0,
          sortOrder: Number(r.sortOrder ?? 0),
          _key: `site-${i}-${r.id}`,
        }))
      );
      setSiteItemsLoaded(true);
    } catch (e) {
      setError(e?.message || 'Site-Objekt-Katalog laden fehlgeschlagen');
    }
  }

  async function saveSiteItems(e) {
    e?.preventDefault?.();
    setSiteItemsMsg('');
    setError('');
    setSiteItemsBusy(true);
    try {
      const items = siteItems.map((r) => {
        let config = {};
        const txt = (r.configText || '').trim();
        if (txt) {
          try {
            const parsed = JSON.parse(txt);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
          } catch {
            throw new Error(`Config bei "${r.id || '?'}" ist kein gültiges JSON.`);
          }
        }
        return {
          id: r.id.trim(),
          kind: r.kind.trim(),
          variant: r.variant.trim(),
          name: r.name.trim(),
          description: r.description.trim(),
          behavior: r.behavior.trim() || 'none',
          config,
          enabled: r.enabled ? 1 : 0,
          sortOrder: Number(r.sortOrder) || 0,
        };
      });
      const res = await fetch('/api/admin/site-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
      setSiteItemsMsg(`Katalog: ${data.count ?? items.length} Einträge gespeichert.`);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSiteItemsBusy(false);
    }
  }

  function addSiteItemRow() {
    setSiteItems((prev) => [
      ...prev,
      {
        id: '',
        kind: 'collectible',
        variant: '',
        name: '',
        description: '',
        behavior: 'none',
        configText: '{}',
        enabled: 1,
        sortOrder: 0,
        _key: `new-site-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      },
    ]);
  }

  async function loadQmItemsPayload() {
    if (qmLoaded) return;
    try {
      const res = await fetch('/api/rpg/questmaker-items', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Questmaker-Katalog');
      const rows = Array.isArray(data.items) ? data.items : [];
      setQmItems(
        rows.map((r, i) => ({
          id: String(r.id ?? ''),
          category: String(r.category ?? 'sonstiges'),
          title: String(r.title ?? ''),
          description: String(r.description ?? ''),
          _key: `qm-${i}-${r.id}`,
        }))
      );
      setQmLoaded(true);
    } catch {
      /* optional */
    }
  }

  useEffect(() => {
    loadPanel()
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Lazy: wenn der User in einen Tab springt, laden wir die Daten dafuer sofort.
  useEffect(() => {
    if (loading) return;
    if (activeSection === 'notes') void loadNotesPayload();
    if (activeSection === 'site-items') void loadSiteItemsPayload();
    if (activeSection === 'fonts') void loadFontsPayload();
    if (activeSection === 'tester-bugs') void loadTesterBugsPayload();
    if (activeSection === 'questmaker') void loadQmItemsPayload();
  }, [loading, activeSection]);

  // Background-Prefetch: kurze Zeit nach dem ersten Render holen wir die teuren
  // Sub-Daten im Hintergrund nach, damit Tab-Wechsel danach instant sind.
  // Wenn ein Tab vor Ablauf des Timers schon aktiviert wird, hat der Lazy-Effect oben
  // bereits geladen und die `*Loaded`-Guards machen den zweiten Call zum No-Op.
  useEffect(() => {
    if (loading) return;
    const id = setTimeout(() => {
      void loadFontsPayload();
      void loadTesterBugsPayload();
      void loadQmItemsPayload();
    }, 800);
    return () => clearTimeout(id);
  }, [loading]);

  useEffect(() => {
    if (loading || activeSection !== 'feed-policy') return;
    let cancelled = false;
    fetch('/api/admin/feed-policy', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Feed-Policy');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setFeedPolicy({
          allowlist: Array.isArray(data.allowlist) ? data.allowlist : [],
          blocklist: Array.isArray(data.blocklist) ? data.blocklist : [],
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loading, activeSection]);

  useEffect(() => {
    if (loading || activeSection !== 'graffiti') return;
    let cancelled = false;
    fetch('/api/admin/graffiti?limit=40', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Graffiti-Liste');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setGraffitiTileSize(Number(data.tileSize || 512));
        setGraffitiRows(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Graffiti-Liste fehlgeschlagen');
      });
    return () => {
      cancelled = true;
    };
  }, [loading, activeSection]);

  function setFontField(key, value) {
    setFonts((f) => ({ ...f, [key]: value }));
  }

  async function saveFonts(e) {
    e.preventDefault();
    setSaveMsg('');
    setError('');
    const res = await fetch('/api/admin/fonts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fonts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Speichern fehlgeschlagen');
      return;
    }
    setSaveMsg('Schriften gespeichert.');
  }

  async function onUpload(e) {
    e.preventDefault();
    setUploadMsg('');
    setError('');
    const input = document.getElementById('super-font-file');
    const file = input?.files?.[0];
    if (!file) {
      setUploadMsg('Bitte eine Datei wählen.');
      return;
    }
    setUploadBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    if (uploadLabel.trim()) fd.append('label', uploadLabel.trim());
    try {
      const res = await fetch('/api/admin/font-upload', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Upload fehlgeschlagen');
        return;
      }
      setUploadMsg(`Hochgeladen: ${data.family_name}`);
      setUploadLabel('');
      if (input) input.value = '';
      await loadPanel();
      setSaveMsg('');
    } catch (err) {
      setError(err?.message || 'Upload fehlgeschlagen');
    } finally {
      setUploadBusy(false);
    }
  }

  async function saveQuestmakerCatalog(e) {
    e.preventDefault();
    setQmMsg('');
    setError('');
    setQmBusy(true);
    const items = qmItems
      .filter((r) => (r.id || '').trim() && (r.title || '').trim())
      .map((r) => ({
        id: r.id.trim(),
        category: r.category || 'sonstiges',
        title: r.title.trim(),
        description: (r.description || '').trim(),
      }));
    try {
      const res = await fetch('/api/rpg/questmaker-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
      setQmMsg(`Katalog: ${data.items?.length ?? items.length} Einträge gespeichert.`);
      const map = questmakerCatalogToDisplayMap(Array.isArray(data.items) ? data.items : []);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(RPG_QUESTMAKER_CATALOG_EVENT, { detail: { itemCatalog: map } })
        );
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setQmBusy(false);
    }
  }

  async function normalizeRpgStoredPayloads() {
    setRpgNormMsg('');
    setError('');
    setRpgNormBusy(true);
    try {
      const res = await fetch('/api/rpg/quests-normalize-payload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Normalisierung fehlgeschlagen');
      setRpgNormMsg(
        `RPG-DB: ${data.rowsChecked ?? 0} Payload(s) geprüft, ${data.rowsUpdated ?? 0} aktualisiert.`
      );
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRpgNormBusy(false);
    }
  }

  function addQmRow() {
    setQmItems((prev) => [
      ...prev,
      {
        id: '',
        category: 'sonstiges',
        title: '',
        description: '',
        _key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      },
    ]);
  }

  async function togglePermission(username, permission, currentlyHas) {
    const u = users.find((x) => x.username === username);
    const perms = u?.permissions || [];
    if (currentlyHas && permission !== SUPER_PERM && perms.includes(SUPER_PERM)) {
      setError('Zuerst super_access entfernen, um einzelne Rechte zu ändern.');
      return;
    }
    setError('');
    const prevUsers = users;
    const nextHas = !currentlyHas;
    setUsers((p) =>
      p.map((uu) =>
        uu.username === username
          ? applyUserPermissionToggle(uu, permission, nextHas, globalPermissions, knownPermissions)
          : uu
      )
    );
    setPermBusy(`${username}:${permission}`);
    try {
      const url = currentlyHas ? '/api/admin/revoke' : '/api/admin/grant';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, permission }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUsers(prevUsers);
        setError(data.error || 'Recht konnte nicht geändert werden');
      }
    } catch (e) {
      setUsers(prevUsers);
      setError(e?.message || 'Recht konnte nicht geändert werden');
    } finally {
      setPermBusy(null);
    }
  }

  async function toggleGlobalPermission(permission, currentlyActive) {
    setError('');
    const prevGlobal = globalPermissions;
    const prevUsers = users;
    const nextGlobal = currentlyActive
      ? globalPermissions.filter((p) => p !== permission)
      : [...globalPermissions, permission];
    setGlobalPermissions(nextGlobal);
    setUsers((p) =>
      p.map((uu) => ({
        ...uu,
        permissions: deriveEffectivePermissions(uu.permissionStates || {}, nextGlobal, knownPermissions),
      }))
    );
    setPermBusy(`*:${permission}`);
    try {
      const res = await fetch('/api/admin/global-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ permission, active: !currentlyActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGlobalPermissions(prevGlobal);
        setUsers(prevUsers);
        setError(data.error || 'Global konnte nicht geändert werden');
      }
    } catch (e) {
      setGlobalPermissions(prevGlobal);
      setUsers(prevUsers);
      setError(e?.message || 'Global konnte nicht geändert werden');
    } finally {
      setPermBusy(null);
    }
  }

  async function toggleWarning(permission, currentlyActive) {
    setError('');
    const prev = permissionWarnings;
    const next = currentlyActive
      ? permissionWarnings.filter((p) => p !== permission)
      : [...permissionWarnings, permission];
    setPermissionWarnings(next);
    setPermBusy(`warn:${permission}`);
    try {
      const res = await fetch('/api/admin/permission-warning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ permission, active: !currentlyActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPermissionWarnings(prev);
        setError(data.error || 'Banner-Status konnte nicht geändert werden');
      }
    } catch (e) {
      setPermissionWarnings(prev);
      setError(e?.message || 'Banner-Status konnte nicht geändert werden');
    } finally {
      setPermBusy(null);
    }
  }

  async function deleteTesterBugReport(id) {
    setError('');
    setDeleteBugBusyId(String(id));
    try {
      const res = await fetch(`/api/tester-bug-reports/${encodeURIComponent(String(id))}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Löschen fehlgeschlagen');
      setTesterBugReports((prev) => prev.filter((r) => String(r.id) !== String(id)));
    } catch (e) {
      setError(e?.message || 'Löschen fehlgeschlagen');
    } finally {
      setDeleteBugBusyId(null);
    }
  }

  async function deleteGraffitiPage(pagePath) {
    setError('');
    setGraffitiBusyId(String(pagePath));
    try {
      const res = await fetch('/api/admin/graffiti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pagePath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Graffiti-Löschen fehlgeschlagen');
      setGraffitiRows((prev) => prev.filter((r) => r.pagePath !== pagePath));
    } catch (e) {
      setError(e?.message || 'Graffiti-Löschen fehlgeschlagen');
    } finally {
      setGraffitiBusyId(null);
    }
  }

  const sections = [
    { id: 'notes', label: 'Notizen' },
    { id: 'site-items', label: 'Site-Objekte' },
    { id: 'permissions', label: 'Nutzer-Rechte' },
    { id: 'tester-ui', label: 'Eigene Testeroberfläche' },
    { id: 'graffiti', label: 'Graffiti' },
    { id: 'tester-bugs', label: 'Tester-Übersicht & Bugs' },
    { id: 'questmaker', label: 'Questmaker-Katalog' },
    { id: 'feed-policy', label: 'Topic-Feed Vertrauen' },
    { id: 'fonts', label: 'Schriften (global)' },
  ];

  function jumpToSection(id) {
    setActiveSection(id);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }

  if (loading) {
    return (
      <div style={box}>
        <p>Laden…</p>
      </div>
    );
  }

  const famOpts = fontCatalog.options || [];
  const wOpts = fontCatalog.weightOptions || [];

  return (
    <div style={box}>
      {fontPreviewCss ? (
        <style dangerouslySetInnerHTML={{ __html: fontPreviewCss }} />
      ) : null}
      <style>{`
        @media (max-width: 900px) {
          .super-panel-layout {
            grid-template-columns: 1fr !important;
          }
          .super-panel-content {
            grid-column: auto !important;
          }
          .super-panel-menu {
            position: static !important;
            left: auto !important;
            width: auto !important;
          }
        }
      `}</style>
      {error ? <div style={errStyle}>{error}</div> : null}
      {saveMsg ? <div style={okStyle}>{saveMsg}</div> : null}

      <div style={panelLayout} className="super-panel-layout">
        <aside style={menuBox} className="super-panel-menu" aria-label="Themen-Menü">
          <div style={{ ...labelStyle, marginBottom: 8 }}>Themen</div>
          <nav>
            {sections.map((entry) => (
              <button
                key={entry.id}
                type="button"
                style={{
                  ...menuBtn,
                  ...(activeSection === entry.id ? menuBtnActive : null),
                }}
                onClick={() => jumpToSection(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        </aside>

        <main style={panelContent} className="super-panel-content">
      {activeSection === 'notes' && (
      <section style={section} id="super-sec-notes">
        <h2 style={h2}>Notizen</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78, marginBottom: '1rem' }}>
          Privater Notizblock — nur für dich sichtbar. Die letzten {5} Speicherstände werden als Verlauf aufgehoben.
        </p>
        {notesMsg ? <p style={okStyle}>{notesMsg}</p> : null}
        <form onSubmit={saveNotes}>
          <textarea
            value={notesValue}
            onInput={(e) => setNotesValue(e.currentTarget.value)}
            placeholder={notesLoading ? 'Lade…' : 'Hier können deine Notizen rein…'}
            disabled={notesLoading || notesSaving}
            rows={14}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.2)',
              fontSize: '0.95rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              background: 'rgba(255,255,255,0.92)',
              marginBottom: 12,
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <button type="submit" style={btnPrimary} disabled={notesLoading || notesSaving}>
              {notesSaving ? 'Speichern…' : 'Notizen speichern'}
            </button>
          </div>
        </form>
        {notesHistory.length > 1 && (
          <div style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                opacity: 0.8,
                padding: 0,
              }}
              onClick={() => setNotesHistoryOpen((v) => !v)}
            >
              {notesHistoryOpen ? '▾' : '▸'} Verlauf ({notesHistory.length - 1} ältere Version
              {notesHistory.length - 1 !== 1 ? 'en' : ''})
            </button>
            {notesHistoryOpen && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
                {notesHistory.slice(1).map((entry, i) => {
                  const dateLabel = (() => {
                    if (!entry?.savedAt || entry.savedAt === 'migriert') return 'migriert';
                    try {
                      const d = new Date(entry.savedAt);
                      const day = String(d.getDate()).padStart(2, '0');
                      const mon = String(d.getMonth() + 1).padStart(2, '0');
                      const h = String(d.getHours()).padStart(2, '0');
                      const m = String(d.getMinutes()).padStart(2, '0');
                      return `${day}.${mon}. ${h}:${m}`;
                    } catch {
                      return entry.savedAt;
                    }
                  })();
                  const preview = (entry?.note || '').slice(0, 80);
                  return (
                    <li
                      key={`note-hist-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 0',
                        borderTop: '1px solid rgba(0,0,0,0.08)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ opacity: 0.7, minWidth: 110 }}>{dateLabel}</span>
                      <span style={{ flex: 1, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preview}
                        {(entry?.note || '').length > 80 ? '…' : ''}
                      </span>
                      <button
                        type="button"
                        style={{ ...btnPrimary, padding: '5px 10px', fontSize: '0.72rem' }}
                        onClick={() => setNotesValue(entry?.note || '')}
                        disabled={notesSaving}
                      >
                        Laden
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
      )}

      {activeSection === 'site-items' && (
      <section style={section} id="super-sec-site-items">
        <h2 style={h2}>Site-Objekte</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78, marginBottom: '1rem' }}>
          Kanonische Liste aller „Dinge" die auf der Seite rumfliegen oder genutzt werden können —
          Stifte, Spraydosen, Stempel, Sticker, Schwämme, Sammlerstücke, Schlüssel.{' '}
          <strong>Strikt getrennt vom RPG-System.</strong> Behavior steuert, was die Engine damit anstellt:
          <code> draw</code> (Werkzeug im Graffiti-Layer), <code>place</code> (auf Seite platzieren),
          <code> unlock</code> (schaltet etwas frei), <code>none</code> (nur Sammlerstück).
          <code> config</code> ist typ-spezifisch (z. B. <code>{`{"strokeMode":"spray","color":"#000"}`}</code>).
        </p>
        <form onSubmit={saveSiteItems}>
          {siteItems.length === 0 ? (
            <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>Noch keine Einträge.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thtd}>ID</th>
                    <th style={thtd}>Kind</th>
                    <th style={thtd}>Variant</th>
                    <th style={thtd}>Name</th>
                    <th style={thtd}>Behavior</th>
                    <th style={thtd}>Config (JSON)</th>
                    <th style={thtd}>Sort</th>
                    <th style={thtd}>An</th>
                    <th style={thtd} />
                  </tr>
                </thead>
                <tbody>
                  {siteItems.map((row, idx) => (
                    <tr key={row._key || row.id || idx}>
                      <td style={thtd}>
                        <input
                          style={{ ...selectStyle, fontSize: '0.85rem' }}
                          value={row.id}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, id: v } : x)));
                          }}
                          placeholder="z. B. spray_red"
                          autoComplete="off"
                        />
                      </td>
                      <td style={thtd}>
                        <input
                          style={{ ...selectStyle, fontSize: '0.85rem' }}
                          value={row.kind}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, kind: v } : x)));
                          }}
                          placeholder="graffiti/pen/stamp/..."
                          autoComplete="off"
                        />
                      </td>
                      <td style={thtd}>
                        <input
                          style={{ ...selectStyle, fontSize: '0.85rem' }}
                          value={row.variant}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, variant: v } : x)));
                          }}
                          placeholder="black/red/..."
                          autoComplete="off"
                        />
                      </td>
                      <td style={thtd}>
                        <input
                          style={selectStyle}
                          value={row.name}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, name: v } : x)));
                          }}
                          placeholder="Anzeigename"
                        />
                      </td>
                      <td style={thtd}>
                        <select
                          style={selectStyle}
                          value={row.behavior}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, behavior: v } : x)));
                          }}
                        >
                          <option value="draw">draw</option>
                          <option value="place">place</option>
                          <option value="unlock">unlock</option>
                          <option value="none">none</option>
                        </select>
                      </td>
                      <td style={thtd}>
                        <textarea
                          rows={2}
                          style={{ ...selectStyle, fontFamily: 'monospace', fontSize: '0.78rem', minWidth: 200 }}
                          value={row.configText}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, configText: v } : x)));
                          }}
                          placeholder='{"color":"#000"}'
                        />
                      </td>
                      <td style={thtd}>
                        <input
                          type="number"
                          style={{ ...selectStyle, width: 70 }}
                          value={row.sortOrder}
                          onInput={(e) => {
                            const v = Number(e.currentTarget.value) || 0;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, sortOrder: v } : x)));
                          }}
                        />
                      </td>
                      <td style={{ ...thtd, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.enabled)}
                          onChange={(e) => {
                            const v = e.currentTarget.checked ? 1 : 0;
                            setSiteItems((p) => p.map((x, j) => (j === idx ? { ...x, enabled: v } : x)));
                          }}
                        />
                      </td>
                      <td style={thtd}>
                        <button
                          type="button"
                          style={{ ...btnPrimary, padding: '6px 10px', fontSize: '0.75rem' }}
                          onClick={() => setSiteItems((p) => p.filter((_, j) => j !== idx))}
                        >
                          Entf.
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <button type="button" style={btnPrimary} onClick={addSiteItemRow}>
              Zeile hinzufügen
            </button>
            <button type="submit" style={btnPrimary} disabled={siteItemsBusy}>
              {siteItemsBusy ? 'Speichern…' : 'Katalog speichern'}
            </button>
            {siteItemsMsg ? <span style={okStyle}>{siteItemsMsg}</span> : null}
          </div>
        </form>
      </section>
      )}

      {activeSection === 'permissions' && (
      <section style={section} id="super-sec-permissions">
        <h2 style={h2}>Nutzer-Rechte</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78 }}>
          <code>super_access</code> = Vollzugriff (alle Rechte aus dieser Liste).{' '}
          <code>tester_access</code> markiert User als Tester (Bottom-Bar mit Kamera).{' '}
          <code>rpg_access</code> erlaubt das RPG inkl. Questmaker.{' '}
          <code>minigames_access</code> ist derzeit ohne Wirkung — Minigames sind voruebergehend nur fuer Superuser sichtbar (Architektur-Umbau).
        </p>
        <p style={{ fontSize: '0.82rem', opacity: 0.72, marginTop: '-0.4rem', marginBottom: '0.6rem' }}>
          Die Zeile <strong>Global</strong> setzt den Standardwert für ALLE Nutzer (auch neue). Einzelne Nutzer können
          den globalen Default durch Klicken auf ihre Checkbox überschreiben — kursiv markierte Häkchen zeigen Werte,
          die vom globalen Default abweichen.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thtd}>User</th>
                {knownPermissions.map((p) => (
                  <th key={p} style={thtd}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'rgba(0,0,0,0.045)' }}>
                <td style={thtd}>
                  <strong>Global</strong>
                  <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>
                    Standard für alle Nutzer
                  </span>
                </td>
                {knownPermissions.map((p) => {
                  const active = globalPermissions.includes(p);
                  const busy = permBusy === `*:${p}`;
                  const disabled = busy || p === SUPER_PERM;
                  return (
                    <td key={p} style={{ ...thtd, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={disabled}
                        title={
                          p === SUPER_PERM
                            ? 'super_access kann nicht global aktiviert werden'
                            : 'Wenn aktiv: Recht gilt automatisch für jeden Nutzer, außer manuell ausgesetzt'
                        }
                        onChange={() => toggleGlobalPermission(p, active)}
                      />
                    </td>
                  );
                })}
              </tr>
              <tr style={{ background: 'rgba(252, 211, 77, 0.18)' }}>
                <td style={thtd}>
                  <strong>Beware of Bugs</strong>
                  <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>
                    Gelbes Hinweis-Banner auf der Feature-Seite
                  </span>
                </td>
                {knownPermissions.map((p) => {
                  const active = permissionWarnings.includes(p);
                  const busy = permBusy === `warn:${p}`;
                  const nonBannerable = p === SUPER_PERM || p === 'tester_access';
                  return (
                    <td key={p} style={{ ...thtd, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={busy || nonBannerable}
                        title={
                          nonBannerable
                            ? `${p} hat keine Feature-Page — Banner wäre nirgends sichtbar`
                            : 'Wenn aktiv: Seiten mit diesem Recht zeigen einen gelben „Beware of Bugs“-Banner unten rechts'
                        }
                        onChange={() => toggleWarning(p, active)}
                      />
                    </td>
                  );
                })}
              </tr>
              {[...users]
                .sort((a, b) => {
                  const aSuper = (a.permissions || []).includes(SUPER_PERM);
                  const bSuper = (b.permissions || []).includes(SUPER_PERM);
                  if (aSuper !== bSuper) return aSuper ? -1 : 1;
                  return String(a.username || '').localeCompare(String(b.username || ''));
                })
                .map((u) => (
                <tr key={u.username}>
                  <td style={thtd}>
                    <strong>{u.username}</strong>
                    {(u.permissions || []).includes(SUPER_PERM) ? (
                      <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>
                        super_access (Vollzugriff)
                      </span>
                    ) : null}
                  </td>
                  {knownPermissions.map((p) => {
                    const has = effectivePerm(u.permissions, p);
                    const lockedBySuper = p !== SUPER_PERM && (u.permissions || []).includes(SUPER_PERM);
                    const busy = permBusy === `${u.username}:${p}`;
                    const globallyActive = globalPermissions.includes(p);
                    const deviates = p !== SUPER_PERM && has !== globallyActive;
                    return (
                      <td key={p} style={{ ...thtd, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={has}
                          disabled={busy || lockedBySuper}
                          title={
                            lockedBySuper
                              ? 'Zuerst super_access entfernen, um einzelne Rechte zu ändern'
                              : deviates
                                ? globallyActive
                                  ? 'Override: für diesen User ausgesetzt'
                                  : 'Override: für diesen User aktiviert'
                                : globallyActive
                                  ? 'Folgt globalem Default (an)'
                                  : ''
                          }
                          style={
                            deviates
                              ? { outline: '2px dashed rgba(180,90,0,0.55)', outlineOffset: 1 }
                              : globallyActive && !deviates
                                ? { opacity: 0.72 }
                                : undefined
                          }
                          onChange={() => togglePermission(u.username, p, has)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeSection === 'tester-ui' && (
      <section style={section} id="super-sec-tester-ui">
        <h2 style={h2}>Eigene Testeroberfläche</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78 }}>
          Dieser Schalter blendet nur deine eigene Testerleiste ein/aus. Rechte und Testerstatus bleiben gleich.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={testerUiEnabled}
            onChange={(e) => setTesterUiEnabled(e.currentTarget.checked)}
            disabled={testerUiBusy}
          />
          Testerleiste unten anzeigen
        </label>
        <button
          type="button"
          style={btnPrimary}
          disabled={testerUiBusy}
          onClick={async () => {
            setTesterUiBusy(true);
            setTesterUiMsg('');
            setError('');
            try {
              const res = await fetch('/api/user/tester-ui', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ enabled: testerUiEnabled }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
              setTesterUiMsg(testerUiEnabled ? 'Testeroberfläche aktiviert.' : 'Testeroberfläche deaktiviert.');
            } catch (e) {
              setError(e?.message || 'Speichern fehlgeschlagen');
            } finally {
              setTesterUiBusy(false);
            }
          }}
        >
          {testerUiBusy ? 'Speichern…' : 'Speichern'}
        </button>
        {testerUiMsg ? <p style={{ ...okStyle, marginTop: 10 }}>{testerUiMsg}</p> : null}
      </section>
      )}

      {activeSection === 'graffiti' && (
      <section style={section} id="super-sec-graffiti">
        <h2 style={h2}>Graffiti</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78 }}>
          Pro Seite eine Karte mit Composite-Vorschau, Tile-Anzahl, Größe und letztem Update. Der Lösch-Button entfernt
          alle Tiles dieser Seite.
        </p>
        {graffitiRows.length === 0 ? (
          <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>Keine Graffiti-Einträge vorhanden.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {graffitiRows.map((row) => (
              <article
                key={`graffiti-page-${row.pagePath}`}
                style={{
                  border: '1px solid rgba(0,0,0,0.12)',
                  borderRadius: 10,
                  padding: '0.8rem',
                  background: 'rgba(255,255,255,0.55)',
                }}
              >
                <div style={{ fontSize: '0.82rem', marginBottom: 6 }}>
                  <a href={row.pagePath} target="_blank" rel="noreferrer">
                    {row.pagePath}
                  </a>
                </div>
                <div style={{ fontSize: '0.78rem', opacity: 0.7, marginBottom: 8 }}>
                  {row.tileCount} Tiles · {formatBytes(row.totalBytes)} · letzter Update {row.lastUpdated}
                  {row.previewTruncated ? ` · Vorschau zeigt nur die ersten ${row.previewTiles?.length ?? 0}` : ''}
                </div>
                <GraffitiTilePreview tiles={row.previewTiles || []} tileSize={graffitiTileSize} />
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    style={{ ...btnPrimary, padding: '7px 10px', fontSize: '0.75rem' }}
                    disabled={graffitiBusyId === String(row.pagePath)}
                    onClick={() => void deleteGraffitiPage(row.pagePath)}
                  >
                    {graffitiBusyId === String(row.pagePath) ? 'Lösche…' : 'Alle Tiles dieser Seite löschen'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      )}

      {activeSection === 'tester-bugs' && (
      <section style={section} id="super-sec-tester-bugs">
        <h2 style={h2}>Tester-Übersicht & Bug-Screenshots</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78 }}>
          Letzte Einsendungen der Tester mit Screenshot, Kommentar und Quelle.
        </p>
        <div style={{ marginBottom: '1rem' }}>
          <strong>Aktive Tester: </strong>
          {users
            .filter((u) => effectivePerm(u.permissions, 'tester_access'))
            .map((u) => u.username)
            .join(', ') || 'Keine'}
        </div>
        {testerBugReports.length === 0 ? (
          <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>Noch keine Bug-Screenshots.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {testerBugReports.map((rep) => (
              <article
                key={rep.id}
                style={{
                  border: '1px solid rgba(0,0,0,0.12)',
                  borderRadius: 10,
                  padding: '0.8rem',
                  background: 'rgba(255,255,255,0.55)',
                }}
              >
                <div style={{ fontSize: '0.8rem', opacity: 0.75, marginBottom: 6 }}>
                  <strong>{rep.username}</strong> · {rep.createdAt}
                </div>
                <div style={{ fontSize: '0.82rem', marginBottom: 8 }}>
                  <a href={rep.pageUrl} target="_blank" rel="noreferrer">
                    {rep.pageUrl}
                  </a>
                </div>
                {rep.comment ? (
                  <p style={{ fontSize: '0.9rem', marginTop: 0, marginBottom: 10 }}>{rep.comment}</p>
                ) : (
                  <p style={{ fontSize: '0.83rem', opacity: 0.65, marginTop: 0, marginBottom: 10 }}>
                    Kein Kommentar
                  </p>
                )}
                <a href={rep.imageUrl} target="_blank" rel="noreferrer">
                  <img
                    src={rep.imageUrl}
                    alt={`Bug von ${rep.username}`}
                    style={{
                      width: '100%',
                      maxHeight: 360,
                      objectFit: 'contain',
                      borderRadius: 8,
                      border: '1px solid rgba(0,0,0,0.12)',
                      background: 'rgba(0,0,0,0.04)',
                    }}
                    loading="lazy"
                  />
                </a>
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    style={{ ...btnPrimary, padding: '7px 10px', fontSize: '0.75rem' }}
                    disabled={deleteBugBusyId === String(rep.id)}
                    onClick={() => void deleteTesterBugReport(rep.id)}
                  >
                    {deleteBugBusyId === String(rep.id) ? 'Lösche…' : 'Screenshot löschen'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      )}

      {activeSection === 'questmaker' && (
      <section style={section} id="super-sec-questmaker">
        <h2 style={h2}>Questmaker — Item-Katalog</h2>
        <p style={{ fontSize: '0.88rem', opacity: 0.8, marginBottom: '1rem' }}>
          Belohnungen vom Typ „Item“ nutzen Titel und Kurzbeschreibung aus diesem Katalog. Neue Item-IDs müssen
          beim Quest-Speichern vollständig mitgeliefert werden (Editor oder KI) — hier den Bestand pflegen.
        </p>
        <form onSubmit={saveQuestmakerCatalog}>
          {qmItems.length === 0 ? (
            <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>Noch keine Einträge.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thtd}>ID (Slug)</th>
                    <th style={thtd}>Kategorie</th>
                    <th style={thtd}>Titel</th>
                    <th style={thtd}>Kurzbeschreibung</th>
                    <th style={thtd} />
                  </tr>
                </thead>
                <tbody>
                  {qmItems.map((row, idx) => (
                    <tr key={row._key || row.id || idx}>
                      <td style={thtd}>
                        <input
                          style={{ ...selectStyle, fontSize: '0.88rem' }}
                          value={row.id}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setQmItems((p) => p.map((x, j) => (j === idx ? { ...x, id: v } : x)));
                          }}
                          placeholder="z. B. sample-toolbox"
                          autoComplete="off"
                        />
                      </td>
                      <td style={thtd}>
                        <select
                          style={selectStyle}
                          value={row.category}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            setQmItems((p) => p.map((x, j) => (j === idx ? { ...x, category: v } : x)));
                          }}
                        >
                          {RPG_ITEM_CATEGORY_IDS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={thtd}>
                        <input
                          style={selectStyle}
                          value={row.title}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setQmItems((p) => p.map((x, j) => (j === idx ? { ...x, title: v } : x)));
                          }}
                          placeholder="Anzeigename"
                        />
                      </td>
                      <td style={thtd}>
                        <input
                          style={selectStyle}
                          value={row.description}
                          onInput={(e) => {
                            const v = e.currentTarget.value;
                            setQmItems((p) => p.map((x, j) => (j === idx ? { ...x, description: v } : x)));
                          }}
                          placeholder="optional"
                        />
                      </td>
                      <td style={thtd}>
                        <button
                          type="button"
                          style={{ ...btnPrimary, padding: '6px 10px', fontSize: '0.75rem' }}
                          onClick={() => setQmItems((p) => p.filter((_, j) => j !== idx))}
                        >
                          Entf.
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <button type="button" style={btnPrimary} onClick={addQmRow}>
              Zeile hinzufügen
            </button>
            <button type="submit" style={btnPrimary} disabled={qmBusy}>
              {qmBusy ? 'Speichern…' : 'Katalog speichern'}
            </button>
            {qmMsg ? <span style={okStyle}>{qmMsg}</span> : null}
          </div>
        </form>
        <p style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: '1.25rem', marginBottom: '0.5rem' }}>
          <strong>RPG-Graph in der Datenbank normalisieren</strong> — einmalig oder nach größeren Format-Updates:
          alle gespeicherten Quest-Payloads auf Schema v2 bringen (<code>questRewards</code>, Steps-Struktur).
          Unveränderte Zeilen werden nicht geschrieben.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            style={btnPrimary}
            disabled={rpgNormBusy}
            onClick={() => void normalizeRpgStoredPayloads()}
          >
            {rpgNormBusy ? 'Normalisiere…' : 'RPG-Payloads in DB normalisieren'}
          </button>
          {rpgNormMsg ? <span style={okStyle}>{rpgNormMsg}</span> : null}
        </div>
      </section>
      )}

      {activeSection === 'feed-policy' && (
      <section style={section} id="super-sec-feed-policy">
        <h2 style={h2}>Topic-Feed Vertrauen</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.78, marginBottom: '1rem' }}>
          Allowlist (RSS-URL exakt oder Host-Suffix): automatische Ingestion ohne Nutzer-Bestätigung. Blocklist:
          Domains werden gefiltert. Ergänze z. B. <code>arxiv.org</code> als Host oder konkrete{' '}
          <code>https://…/feed</code>-URLs. IEEE/Nature nur nutzen, wenn der jeweilige RSS-Link öffentlich und stabil
          ist.
        </p>
        {fpMsg ? <p style={okStyle}>{fpMsg}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '0.95rem' }}>Allowlist</h3>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid rgba(0,0,0,0.12)', marginBottom: 10 }}>
              <table style={tableStyle}>
                <tbody>
                  {feedPolicy.allowlist.map((row) => (
                    <tr key={row.id}>
                      <td style={thtd}>
                        <code style={{ fontSize: '0.75rem' }}>{row.kind}</code>
                      </td>
                      <td style={thtd}>
                        <span style={{ fontSize: '0.8rem' }}>{row.value}</span>
                      </td>
                      <td style={thtd}>
                        <button
                          type="button"
                          style={{ fontSize: '0.72rem' }}
                          disabled={fpBusy}
                          onClick={async () => {
                            setFpBusy(true);
                            setFpMsg('');
                            try {
                              const res = await fetch('/api/admin/feed-policy', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'same-origin',
                                body: JSON.stringify({ action: 'remove_allow', id: row.id }),
                              });
                              const d = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(d.error || 'Fehler');
                              setFeedPolicy((p) => ({ ...p, allowlist: p.allowlist.filter((x) => x.id !== row.id) }));
                              setFpMsg('Entfernt.');
                            } catch (e) {
                              setError(e?.message || String(e));
                            } finally {
                              setFpBusy(false);
                            }
                          }}
                        >
                          Entf.
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setFpBusy(true);
                setFpMsg('');
                try {
                  const res = await fetch('/api/admin/feed-policy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                      action: 'add_allow',
                      kind: fpKind,
                      value: fpValue.trim(),
                      category: fpCategory.trim(),
                      trust_tier: Number(fpTier) || 2,
                    }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || 'Fehler');
                  setFpValue('');
                  setFpMsg('Allowlist-Eintrag hinzugefügt.');
                  const r2 = await fetch('/api/admin/feed-policy', { credentials: 'same-origin' });
                  const d2 = await r2.json();
                  if (r2.ok) setFeedPolicy({ allowlist: d2.allowlist || [], blocklist: d2.blocklist || [] });
                } catch (err) {
                  setError(err?.message || String(err));
                } finally {
                  setFpBusy(false);
                }
              }}
            >
              <select value={fpKind} onChange={(e) => setFpKind(e.currentTarget.value)} style={selectStyle}>
                <option value="host_suffix">host_suffix</option>
                <option value="rss_url">rss_url</option>
              </select>
              <input
                placeholder="z. B. arxiv.org oder https://…/rss"
                value={fpValue}
                onInput={(e) => setFpValue(e.currentTarget.value)}
                style={{ ...selectStyle, display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box' }}
              />
              <input
                placeholder="Kategorie (optional)"
                value={fpCategory}
                onInput={(e) => setFpCategory(e.currentTarget.value)}
                style={{ ...selectStyle, display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box' }}
              />
              <input
                type="number"
                title="trust_tier"
                value={fpTier}
                onInput={(e) => setFpTier(Number(e.currentTarget.value))}
                style={{ ...selectStyle, display: 'block', width: 100, marginTop: 6 }}
              />
              <button type="submit" style={{ ...btnPrimary, marginTop: 8 }} disabled={fpBusy}>
                Hinzufügen
              </button>
            </form>
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem' }}>Blocklist</h3>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid rgba(0,0,0,0.12)', marginBottom: 10 }}>
              <table style={tableStyle}>
                <tbody>
                  {feedPolicy.blocklist.map((row) => (
                    <tr key={row.id}>
                      <td style={thtd}>{row.host_pattern}</td>
                      <td style={thtd}>
                        <button
                          type="button"
                          style={{ fontSize: '0.72rem' }}
                          disabled={fpBusy}
                          onClick={async () => {
                            setFpBusy(true);
                            setFpMsg('');
                            try {
                              const res = await fetch('/api/admin/feed-policy', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'same-origin',
                                body: JSON.stringify({ action: 'remove_block', id: row.id }),
                              });
                              const d = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(d.error || 'Fehler');
                              setFeedPolicy((p) => ({ ...p, blocklist: p.blocklist.filter((x) => x.id !== row.id) }));
                              setFpMsg('Entfernt.');
                            } catch (e) {
                              setError(e?.message || String(e));
                            } finally {
                              setFpBusy(false);
                            }
                          }}
                        >
                          Entf.
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setFpBusy(true);
                setFpMsg('');
                try {
                  const res = await fetch('/api/admin/feed-policy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ action: 'add_block', host_pattern: fpBlock.trim() }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || 'Fehler');
                  setFpBlock('');
                  setFpMsg('Blocklist-Eintrag hinzugefügt.');
                  const r2 = await fetch('/api/admin/feed-policy', { credentials: 'same-origin' });
                  const d2 = await r2.json();
                  if (r2.ok) setFeedPolicy({ allowlist: d2.allowlist || [], blocklist: d2.blocklist || [] });
                } catch (err) {
                  setError(err?.message || String(err));
                } finally {
                  setFpBusy(false);
                }
              }}
            >
              <input
                placeholder="Host-Substring z. B. example-spam.com"
                value={fpBlock}
                onInput={(e) => setFpBlock(e.currentTarget.value)}
                style={{ ...selectStyle, display: 'block', width: '100%', boxSizing: 'border-box' }}
              />
              <button type="submit" style={{ ...btnPrimary, marginTop: 8 }} disabled={fpBusy}>
                Blocken
              </button>
            </form>
          </div>
        </div>
      </section>
      )}

      {activeSection === 'fonts' && (
      <section style={section} id="super-sec-fonts">
        <h2 style={h2}>Schriften (global)</h2>
        <p style={{ fontSize: '0.88rem', opacity: 0.8, marginBottom: '1.2rem' }}>
          Schriftfamilien aus der Liste wählen — jede Zeile in ihrer Schrift. Leer =
          Theme-Standard. Hochgeladene Schriften landen in Turso (Blob) und stehen überall zur
          Verfügung.
        </p>

        <form onSubmit={saveFonts}>
          {FONT_FAMILY_KEYS.map((key) => {
            const merged = mergeCatalogOptions(fonts[key], famOpts);
            return (
              <div key={key} style={inputRow}>
                <label style={labelStyle}>{FONT_SETTING_LABELS[key] || key}</label>
                <select
                  style={{
                    ...selectStyle,
                    fontFamily: (fonts[key] && previewFamilyForValue(fonts[key])) || 'inherit',
                  }}
                  value={fonts[key] ?? ''}
                  onChange={(e) => setFontField(key, e.target.value)}
                >
                  {merged.map((o) => (
                    <option
                      key={`${key}-${o.value}-${o.label}`}
                      value={o.value}
                      style={{ fontFamily: o.previewFamily || 'inherit' }}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
                {fonts[key] ? (
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: '1.35rem',
                      lineHeight: 1.3,
                      fontFamily: previewFamilyForValue(fonts[key]),
                    }}
                  >
                    Aa Bb Üö 123 — Vorschau
                  </p>
                ) : null}
              </div>
            );
          })}
          {FONT_WEIGHT_KEYS.map((key) => (
            <div key={key} style={inputRow}>
              <label style={labelStyle}>{FONT_SETTING_LABELS[key] || key}</label>
              <select
                style={selectStyle}
                value={fonts[key] ?? ''}
                onChange={(e) => setFontField(key, e.target.value)}
              >
                {wOpts.map((w) => (
                  <option key={key + w} value={w}>
                    {w === '' ? '(Theme-Standard)' : w}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button type="submit" style={btnPrimary}>
            Schriften speichern
          </button>
        </form>

        <div
          style={{
            marginTop: '2rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid rgba(0,0,0,0.12)',
          }}
        >
          <h3 style={{ ...h2, marginBottom: '0.75rem' }}>Neue Schrift hochladen</h3>
          <p style={{ fontSize: '0.85rem', opacity: 0.75, marginBottom: '0.75rem' }}>
            .ttf, .otf, .woff, .woff2 — max. 2&nbsp;MB. Optionaler Anzeigename (sonst Dateiname).
          </p>
          <form onSubmit={onUpload}>
            <div style={{ ...inputRow, marginBottom: 10 }}>
              <label style={labelStyle}>Bezeichnung (optional)</label>
              <input
                type="text"
                value={uploadLabel}
                onInput={(e) => setUploadLabel(e.target.value)}
                style={{
                  ...selectStyle,
                  fontSize: '0.95rem',
                }}
                placeholder="z. B. Meine Display-Schrift"
                autoComplete="off"
              />
            </div>
            <div style={{ ...inputRow, marginBottom: 12 }}>
              <label style={labelStyle}>Datei</label>
              <input id="super-font-file" type="file" accept=".ttf,.otf,.woff,.woff2,font/*" />
            </div>
            <button type="submit" style={btnPrimary} disabled={uploadBusy}>
              {uploadBusy ? 'Lade hoch…' : 'Hochladen'}
            </button>
          </form>
          {uploadMsg ? <p style={{ ...okStyle, marginTop: 12 }}>{uploadMsg}</p> : null}
        </div>
      </section>
      )}
        </main>
      </div>
    </div>
  );
}
