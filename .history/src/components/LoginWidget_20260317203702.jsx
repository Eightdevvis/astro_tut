import React, { useState, useEffect } from 'react';

/**
 * LoginWidget.jsx
 * Zeigt oben rechts einen Login-Button, Popup für Login/Register, und Konto-Ansicht.
 * Demo-Logik: Fake-Login/Register, Zustand in localStorage.
 * Kommentare erklären das WARUM und das WAS.
 */

const LOCAL_KEY = 'astro_demo_user';

function LoginWidget() {
  // Zustand: eingeloggt, Popup offen, Register-Modus, Form-Daten, Fehler
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', birthday: '', password2: '' });
  const [error, setError] = useState('');

  // Beim Laden: User aus localStorage holen
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_KEY);
    if (saved) setUser(JSON.parse(saved));
  }, []);

  // Form-Handler
  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  // Login-Logik: Fake-Check
  function handleLogin(e) {
    e.preventDefault();
    // Demo: Username = "test", Passwort = "1234"
    if (form.username === 'test' && form.password === '1234') {
      const demoUser = { username: 'test', birthday: '01-01' };
      localStorage.setItem(LOCAL_KEY, JSON.stringify(demoUser));
      setUser(demoUser);
      setOpen(false);
      setError('');
    } else {
      setError('Falscher Username oder Passwort');
    }
  }

  // Register-Logik: Validierung, Demo-Speichern
  function handleRegister(e) {
    e.preventDefault();
    if (!form.username || !form.birthday || !form.password || !form.password2) {
      setError('Alle Felder ausfüllen');
      return;
    }
    if (form.password !== form.password2) {
      setError('Passwörter stimmen nicht überein');
      return;
    }
    // Demo: User speichern
    const newUser = { username: form.username, birthday: form.birthday };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(newUser));
    setUser(newUser);
    setOpen(false);
    setError('');
  }

  // Logout
  function handleLogout() {
    localStorage.removeItem(LOCAL_KEY);
    setUser(null);
    setForm({ username: '', password: '', birthday: '', password2: '' });
    setError('');
  }

  // Popup-Fenster
  function renderPopup() {
    return (
      <div style={popupStyle}>
        <form onSubmit={registerMode ? handleRegister : handleLogin}>
          <div style={{ marginBottom: 8 }}>
            <input
              name="username"
              placeholder="Username"
              value={form.username}
              onChange={handleChange}
              style={inputStyle}
            />
          </div>
          {registerMode && (
            <div style={{ marginBottom: 8 }}>
              <input
                name="birthday"
                placeholder="Geburtstag (MM-TT)"
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
              placeholder="Passwort"
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
                placeholder="Passwort wiederholen"
                value={form.password2}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>
          )}
          {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
          <button type="submit" style={buttonStyle}>
            {registerMode ? 'Registrieren' : 'Login'}
          </button>
        </form>
        <div style={{ marginTop: 8 }}>
          {!registerMode ? (
            <a href="#" style={linkStyle} onClick={() => { setRegisterMode(true); setError(''); }}>
              Register
            </a>
          ) : (
            <a href="#" style={linkStyle} onClick={() => { setRegisterMode(false); setError(''); }}>
              Zurück zum Login
            </a>
          )}
        </div>
      </div>
    );
  }

  // Haupt-Render
  return (
    <div style={containerStyle}>
      {!user ? (
        <button style={buttonStyle} onClick={() => setOpen(!open)}>
          Login
        </button>
      ) : (
        <div style={kontoStyle}>
          <span>👤 {user.username} ({user.birthday})</span>
          <button style={logoutStyle} onClick={handleLogout}>Logout</button>
        </div>
      )}
      {open && renderPopup()}
    </div>
  );
}

// Styling für das Widget
const containerStyle = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 1000,
};
const popupStyle = {
  background: '#fff',
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  minWidth: 220,
};
const inputStyle = {
  width: '100%',
  padding: 6,
  borderRadius: 4,
  border: '1px solid #aaa',
};
const buttonStyle = {
  width: '100%',
  padding: 8,
  borderRadius: 4,
  background: '#e91e63',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
};
const linkStyle = {
  color: '#1976d2',
  fontSize: 13,
  cursor: 'pointer',
};
const kontoStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: '#f5f5f5',
  borderRadius: 8,
  padding: '6px 12px',
};
const logoutStyle = {
  padding: '4px 8px',
  borderRadius: 4,
  background: '#aaa',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
};

export default LoginWidget;

/**
 * Stolperstellen:
 * - Demo-Logik: Kein echtes Backend, keine Sicherheit!
 * - localStorage: User bleibt eingeloggt bis Logout oder Browser-Reset
 * - Geburtstag: Keine echte Validierung, nur MM-TT
 * - Styling: Minimal, kann angepasst werden
 * - Edge Cases: Mehrfach-Registrierung, Username-Check fehlt
 */
