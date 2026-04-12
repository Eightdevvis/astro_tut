import { useState, useEffect } from 'preact/hooks';
import {
  FONT_SETTING_LABELS,
  FONT_FAMILY_KEYS,
  FONT_WEIGHT_KEYS,
} from '../constants/font-settings.js';
import { previewFamilyForValue } from '../constants/font-preview-helpers.js';
import { RPG_ITEM_CATEGORY_IDS } from '../lib/rpg-item-categories.js';

const box = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '0 1rem 3rem',
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
  const [users, setUsers] = useState([]);
  const [knownPermissions, setKnownPermissions] = useState([]);
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
  const [permBusy, setPermBusy] = useState(null);
  const [superuserName, setSuperuserName] = useState('sash');
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [qmItems, setQmItems] = useState([]);
  const [qmMsg, setQmMsg] = useState('');
  const [qmBusy, setQmBusy] = useState(false);

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
        if (data.superuser) setSuperuserName(data.superuser);
        setFontCatalog(data.fontCatalog || { options: [], weightOptions: [] });
        setFontPreviewCss(data.fontPreviewCss || '');
        const next = {};
        for (const k of [...FONT_FAMILY_KEYS, ...FONT_WEIGHT_KEYS]) {
          next[k] =
            data.fonts && data.fonts[k] != null ? String(data.fonts[k]) : '';
        }
        setFonts(next);
      });
  }

  useEffect(() => {
    loadPanel()
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    fetch('/api/rpg/questmaker-items', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Questmaker-Katalog');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
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
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, [loading]);

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
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setQmBusy(false);
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
    if (username === superuserName) return;
    setPermBusy(`${username}:${permission}`);
    setError('');
    const url = currentlyHas ? '/api/admin/revoke' : '/api/admin/grant';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, permission }),
    });
    const data = await res.json().catch(() => ({}));
    setPermBusy(null);
    if (!res.ok) {
      setError(data.error || 'Recht konnte nicht geändert werden');
      return;
    }
    setUsers((prev) =>
      prev.map((u) => {
        if (u.username !== username) return u;
        const set = new Set(u.permissions || []);
        if (currentlyHas) set.delete(permission);
        else set.add(permission);
        return { ...u, permissions: [...set] };
      })
    );
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
      {error ? <div style={errStyle}>{error}</div> : null}
      {saveMsg ? <div style={okStyle}>{saveMsg}</div> : null}

      <section style={section}>
        <h2 style={h2}>Nutzer-Rechte</h2>
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
              {users.map((u) => (
                <tr key={u.username}>
                  <td style={thtd}>
                    <strong>{u.username}</strong>
                    {u.username === superuserName ? (
                      <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>
                        Superuser
                      </span>
                    ) : null}
                  </td>
                  {knownPermissions.map((p) => {
                    const has = (u.permissions || []).includes(p);
                    const busy =
                      permBusy === `${u.username}:${p}` || u.username === superuserName;
                    return (
                      <td key={p} style={{ ...thtd, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={has}
                          disabled={busy}
                          title={
                            u.username === superuserName
                              ? 'Superuser hat immer alle Rechte'
                              : ''
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

      <section style={section}>
        <h2 style={h2}>Questmaker — Item-Katalog</h2>
        <p style={{ fontSize: '0.88rem', opacity: 0.8, marginBottom: '1rem' }}>
          Belohnungen vom Typ „Item“ beziehen Anzeigenamen hierher. Beim Speichern von Quests werden fehlende
          IDs automatisch mit Platzhalter angelegt — hier pflegen und korrigieren.
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
      </section>

      <section style={section}>
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
    </div>
  );
}
