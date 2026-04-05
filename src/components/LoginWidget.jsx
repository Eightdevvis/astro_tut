import { useState, useEffect } from 'preact/hooks';


function LoginWidget() {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', birthday: '', password2: '' });
  const [error, setError] = useState('');

  // Beim Laden: Session vom Backend prüfen
  useEffect(() => {
    fetch('/api/user').then(async res => {
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
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
      setUser(data.user);
      setOpen(false);
      setForm({ username: '', password: '', birthday: '', password2: '' });
    } else {
      setError(data.error || 'Login fehlgeschlagen');
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    if (!form.username || !form.birthday || !form.password || !form.password2) {
      setError('Alle Felder ausfüllen');
      return;
    }
    if (form.password !== form.password2) {
      setError('Passwörter stimmen nicht überein');
      return;
    }
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username, birthday: form.birthday, password: form.password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      setUser(data.user);
      setOpen(false);
      setForm({ username: '', password: '', birthday: '', password2: '' });
    } else {
      setError(data.error || 'Registrierung fehlgeschlagen');
    }
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
    setForm({ username: '', password: '', birthday: '', password2: '' });
    setError('');
  }

  // Das ausgeklappte Popup — eingeloggt zeigt Konto-Infos, ausgeloggt zeigt Login/Register
  function renderPopup() {
    if (user) {
      // Eingeloggt: Name, Geburtstag, Logout
      return (
        <div style={popupStyle}>
          <div style={{ marginBottom: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#555' }}>EINGELOGGT ALS</div>
            <div style={{ fontWeight: 'bold', fontSize: 16 }}>{user.username.toUpperCase()}</div>
            <div style={{ fontSize: 13, color: '#555' }}>{user.birthday}</div>
          </div>
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
    return (
      <div style={popupStyle}>
        <form onSubmit={registerMode ? handleRegister : handleLogin}>
          <div style={{ marginBottom: 8 }}>
            <input
              name="username"
              placeholder="USERNAME"
              value={form.username}
              onChange={handleChange}
              style={inputStyle}
            />
          </div>
          {registerMode && (
            <div style={{ marginBottom: 8 }}>
              <input
                name="birthday"
                placeholder="GEBURTSTAG (MM-TT)"
                value={form.birthday}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <input
              name="password"
              type="password"
              placeholder="PASSWORT"
              value={form.password}
              onChange={handleChange}
              style={inputStyle}
            />
          </div>
          {registerMode && (
            <div style={{ marginBottom: 8 }}>
              <input
                name="password2"
                type="password"
                placeholder="PASSWORT WIEDERHOLEN"
                value={form.password2}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>
          )}
          {error && <div style={{ color: 'red', marginBottom: 8, fontSize: 12 }}>{error.toUpperCase()}</div>}
          <button type="submit" style={submitStyle}>
            {registerMode ? 'REGISTRIEREN' : 'LOGIN'}
          </button>
        </form>
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          {!registerMode ? (
            <a href="#" style={linkStyle} onClick={e => { e.preventDefault(); setRegisterMode(true); setError(''); }}>
              REGISTRIEREN
            </a>
          ) : (
            <a href="#" style={linkStyle} onClick={e => { e.preventDefault(); setRegisterMode(false); setError(''); }}>
              ZURÜCK ZUM LOGIN
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Einziger Button: großes Human-Head-Icon, egal ob ein- oder ausgeloggt */}
      <button
        style={iconButtonStyle}
        onClick={() => { setOpen(!open); setRegisterMode(false); setError(''); }}
        title={user ? user.username : 'Login'}
      >
        {/* SVG Human Head Icon */}
        <svg width="38" height="38" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
      </button>
      {open && renderPopup()}
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
  background: 'rgba(173, 216, 230, 0.75)',  // lightblue mit 75% opacity
  backdropFilter: 'blur(6px)',               // Glassmorphism-Effekt
  border: '1px solid rgba(173, 216, 230, 0.5)',
  borderRadius: 8,
  padding: 16,
  minWidth: 220,
  zIndex: 1000,
  textTransform: 'uppercase',
};

const inputStyle = {
  width: '100%',
  padding: 6,
  borderRadius: 4,
  border: '1px solid rgba(0,0,0,0.2)',
  background: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  boxSizing: 'border-box',
};

const submitStyle = {
  width: '100%',
  padding: 8,
  borderRadius: 4,
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
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
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  textTransform: 'uppercase',
  fontWeight: 'bold',
  letterSpacing: 1,
};

const linkStyle = {
  color: '#003366',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  letterSpacing: 1,
};

export default LoginWidget;
