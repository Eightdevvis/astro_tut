import { useState, useEffect } from 'preact/hooks';
import RegisterModal from './RegisterModal.jsx';


function LoginWidget({ initialUser = null }) {
  const [user, setUser] = useState(initialUser);
  const [authResolved, setAuthResolved] = useState(Boolean(initialUser));
  const [open, setOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  // Beim Laden: Session vom Backend prüfen
  useEffect(() => {
    fetch('/api/user').then(async res => {
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setAuthResolved(true);
      } else {
        setAuthResolved(true);
      }
    }).catch(() => {
      setAuthResolved(true);
    });
  }, []);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username, password: form.password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      window.location.reload();
      return;
    } else {
      setError(data.error || 'Login fehlgeschlagen');
    }
  }

  async function handleLogout() {
    const res = await fetch('/api/logout', { method: 'POST' });
    if (res.ok) {
      window.location.reload();
      return;
    }
    setUser(null);
    setForm({ username: '', password: '' });
    setError('');
  }

  const displayLabel = user ? (user.displayName || user.username) : '';
  const showLoginId = user && user.displayName && user.displayName !== user.username;

  // Das ausgeklappte Popup — eingeloggt zeigt Konto-Infos, ausgeloggt zeigt Login + Register-Link
  function renderPopup() {
    if (user) {
      // Eingeloggt: Display-Name (+ Login-ID wenn abweichend), Geburtstag, Logout
      return (
        <div style={popupStyle}>
          <div style={{ marginBottom: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--site-soft-muted)' }}>EINGELOGGT ALS</div>
            <div style={{ fontWeight: 'bold', fontSize: 16 }}>{displayLabel}</div>
            {showLoginId && (
              <div style={{ fontSize: 11, color: 'var(--site-soft-muted)', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                @{user.username}
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--site-soft-muted)' }}>{user.birthday}</div>
          </div>
          <a
            href="/me"
            style={{
              ...linkStyle,
              display: 'block',
              textAlign: 'center',
              marginBottom: 10,
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            DEINE SEITE
          </a>
          <a
            href="/settings"
            style={{
              ...linkStyle,
              display: 'block',
              textAlign: 'center',
              marginBottom: 10,
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            EINSTELLUNGEN
          </a>
          {user.isSuperuser && (
            <a
              href="/super/settings"
              style={{
                ...linkStyle,
                display: 'block',
                textAlign: 'center',
                marginBottom: 10,
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              SUPER-EINSTELLUNGEN
            </a>
          )}
          <button style={logoutStyle} onClick={handleLogout}>LOGOUT</button>
        </div>
      );
    }

    // Ausgeloggt: Login / Register Formular
    if (!authResolved) {
      return (
        <div style={popupStyle}>
          <div style={{ fontSize: 13, color: 'var(--site-soft-muted)', textAlign: 'center' }}>SESSION WIRD GELADEN…</div>
        </div>
      );
    }
    return (
      <div style={popupStyle}>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 8 }}>
            <input
              name="username"
              placeholder="LOGIN-ID"
              value={form.username}
              onChange={handleChange}
              style={inputStyle}
              autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              name="password"
              type="password"
              placeholder="PASSWORT"
              value={form.password}
              onChange={handleChange}
              style={inputStyle}
              autoComplete="current-password"
            />
          </div>
          {error && <div style={{ color: '#b00020', marginBottom: 8, fontSize: 12 }}>{error.toUpperCase()}</div>}
          <button type="submit" style={submitStyle}>LOGIN</button>
        </form>
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <a
            href="#"
            style={linkStyle}
            onClick={(e) => {
              e.preventDefault();
              setRegisterOpen(true);
              setError('');
              setOpen(false);
            }}
          >
            REGISTRIEREN
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Einziger Button: großes Human-Head-Icon, egal ob ein- oder ausgeloggt */}
      <button
        type="button"
        style={iconButtonStyle}
        onClick={() => { setOpen(!open); setError(''); }}
        aria-label={user ? `Konto (${displayLabel})` : 'Anmelden oder registrieren'}
        title={user ? `Eingeloggt als ${displayLabel} — Konto öffnen` : 'Anmelden oder registrieren'}
      >
        {/* SVG Human Head Icon */}
        <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
      </button>
      {open && renderPopup()}
      {registerOpen && (
        <RegisterModal
          onClose={() => setRegisterOpen(false)}
          onRegistered={(u) => {
            setUser(u);
            setRegisterOpen(false);
            setForm({ username: '', password: '' });
          }}
        />
      )}
    </div>
  );
}

const containerStyle = {
  position: 'relative',
};

// Transparenter Button, nur das Icon
const iconButtonStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--nav2-fg)',
  cursor: 'pointer',
  padding: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// Hellblau + transparent als Hintergrund
const popupStyle = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  background: 'var(--site-control-bg)',
  color: 'var(--site-body-text)',
  backdropFilter: 'blur(6px)',
  border: '1px solid var(--site-control-border)',
  borderRadius: 8,
  padding: 16,
  minWidth: 220,
  zIndex: 1000,
};

const inputStyle = {
  width: '100%',
  padding: 6,
  borderRadius: 4,
  border: '1px solid var(--site-control-border)',
  background: 'var(--site-card-bg)',
  color: 'var(--site-body-text)',
  boxSizing: 'border-box',
};

const submitStyle = {
  width: '100%',
  padding: 8,
  borderRadius: 4,
  background: 'var(--site-control-bg-strong)',
  color: 'var(--site-control-fg-strong)',
  border: 'none',
  cursor: 'pointer',
  textTransform: 'uppercase',
  fontWeight: 'bold',
  letterSpacing: 1,
};

const logoutStyle = {
  width: '100%',
  padding: 8,
  borderRadius: 4,
  background: 'var(--site-control-bg-strong)',
  color: 'var(--site-control-fg-strong)',
  border: 'none',
  cursor: 'pointer',
  textTransform: 'uppercase',
  fontWeight: 'bold',
  letterSpacing: 1,
};

const linkStyle = {
  color: 'var(--site-link)',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  letterSpacing: 1,
};

export default LoginWidget;
