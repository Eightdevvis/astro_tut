import { useState, useEffect } from 'preact/hooks';
import { FONT_SETTING_KEYS, FONT_SETTING_LABELS } from '../constants/font-settings.js';

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

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.2)',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
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

export default function SuperSettings() {
  const [users, setUsers] = useState([]);
  const [knownPermissions, setKnownPermissions] = useState([]);
  const [fonts, setFonts] = useState(() => {
    const o = {};
    for (const k of FONT_SETTING_KEYS) o[k] = '';
    return o;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [permBusy, setPermBusy] = useState(null);
  const [superuserName, setSuperuserName] = useState('sash');

  useEffect(() => {
    fetch('/api/admin/panel', { credentials: 'same-origin' })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
        return data;
      })
      .then(data => {
        setUsers(data.users || []);
        setKnownPermissions(data.knownPermissions || []);
        if (data.superuser) setSuperuserName(data.superuser);
        const next = {};
        for (const k of FONT_SETTING_KEYS) {
          next[k] = data.fonts && data.fonts[k] != null ? String(data.fonts[k]) : '';
        }
        setFonts(next);
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  function setFontField(key, value) {
    setFonts(f => ({ ...f, [key]: value }));
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
    setSaveMsg('Schriftarten gespeichert.');
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
    setUsers(prev =>
      prev.map(u => {
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

  return (
    <div style={box}>
      {error ? <div style={errStyle}>{error}</div> : null}
      {saveMsg ? <div style={okStyle}>{saveMsg}</div> : null}

      <section style={section}>
        <h2 style={h2}>Nutzer-Rechte</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thtd}>User</th>
                {knownPermissions.map(p => (
                  <th key={p} style={thtd}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.username}>
                  <td style={thtd}>
                    <strong>{u.username}</strong>
                    {u.username === superuserName ? (
                      <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>Superuser</span>
                    ) : null}
                  </td>
                  {knownPermissions.map(p => {
                    const has = (u.permissions || []).includes(p);
                    const busy =
                      permBusy === `${u.username}:${p}` || u.username === superuserName;
                    return (
                      <td key={p} style={{ ...thtd, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={has}
                          disabled={busy}
                          title={u.username === superuserName ? 'Superuser hat immer alle Rechte' : ''}
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
        <h2 style={h2}>Schriften (global)</h2>
        <p style={{ fontSize: '0.88rem', opacity: 0.8, marginBottom: '1.2rem' }}>
          Leere Felder = Standard aus dem Theme. Namen mit Leerzeichen sind erlaubt (z.&nbsp;B.{' '}
          <code>Black Spiral</code>). Schriftstärken als Zahl (z.&nbsp;B. 400, 700).
        </p>
        <form onSubmit={saveFonts}>
          {FONT_SETTING_KEYS.map(key => (
            <div key={key} style={inputRow}>
              <label style={labelStyle}>{FONT_SETTING_LABELS[key] || key}</label>
              <input
                style={inputStyle}
                value={fonts[key] ?? ''}
                onInput={e => setFontField(key, e.target.value)}
                placeholder="(Standard)"
                autoComplete="off"
              />
            </div>
          ))}
          <button type="submit" style={btnPrimary}>
            Schriften speichern
          </button>
        </form>
      </section>
    </div>
  );
}
