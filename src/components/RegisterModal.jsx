import { useState, useEffect, useRef } from 'preact/hooks';

/**
 * RegisterModal
 *
 * Eigenes Modal-Overlay fuer Registrierung. Felder:
 *  - Name (display_name, frei waehlbar, kann sich mit anderen ueberschneiden)
 *  - Login-ID (eindeutig, automatisch aus Name vorgeschlagen, editierbar)
 *  - Geburtstag (TT-MM)
 *  - Passwort + Passwort wiederholen
 *
 * Live-Suggestion: jedesmal wenn Name oder ID geaendert wird, fragen wir
 * /api/auth/check-id, ob die ID frei ist und holen ggf. die naechste freie
 * Variante. Die User-Bearbeitung der ID wird respektiert (kein Auto-Reset).
 *
 * Props:
 *  - onClose(): Modal schliessen
 *  - onRegistered(user): Aufruf nach erfolgreichem Register mit dem User-Objekt.
 */
export default function RegisterModal({ onClose, onRegistered }) {
  const [name, setName] = useState('');
  const [loginId, setLoginId] = useState('');
  const [loginIdTouched, setLoginIdTouched] = useState(false);
  const [birthday, setBirthday] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [idStatus, setIdStatus] = useState({ checking: false, available: null, suggestion: '' });
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    nameInputRef.current?.focus();
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Wenn der User die ID NICHT manuell veraendert hat, wird sie aus dem Namen
  // abgeleitet (slugify + Auto-Suffix bei Konflikt, vom Server geprueft).
  // Der Server-Response `data.available` bezieht sich auf den Slug aus dem
  // Namen — wir uebernehmen aber `data.suggestion`, die per Definition frei
  // ist. Darum hier `available: null` setzen und den Hint via `loginIdTouched`
  // gesondert formulieren.
  useEffect(() => {
    if (loginIdTouched) return;
    if (!name.trim()) {
      setLoginId('');
      setIdStatus({ checking: false, available: null, suggestion: '' });
      return;
    }
    const ctrl = new AbortController();
    setIdStatus((s) => ({ ...s, checking: true }));
    const t = setTimeout(() => {
      fetch(`/api/auth/check-id?name=${encodeURIComponent(name)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          if (loginIdTouched) return;
          setLoginId(String(data.suggestion || ''));
          setIdStatus({ checking: false, available: null, suggestion: data.suggestion });
        })
        .catch(() => {});
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Wenn User die ID manuell editiert: live verfuegbarkeit pruefen.
  useEffect(() => {
    if (!loginIdTouched) return;
    if (!loginId.trim()) {
      setIdStatus({ checking: false, available: null, suggestion: '' });
      return;
    }
    const ctrl = new AbortController();
    setIdStatus((s) => ({ ...s, checking: true }));
    const t = setTimeout(() => {
      fetch(`/api/auth/check-id?id=${encodeURIComponent(loginId)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          setIdStatus({
            checking: false,
            available: data.available,
            shapeError: data.shapeError,
            suggestion: data.suggestion,
          });
        })
        .catch(() => {});
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [loginId, loginIdTouched]);

  function onIdInput(e) {
    setLoginIdTouched(true);
    setLoginId(e.target.value.toLowerCase());
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !loginId.trim() || !birthday.trim() || !password || !password2) {
      setError('Bitte alle Felder ausfüllen');
      return;
    }
    if (password !== password2) {
      setError('Passwörter stimmen nicht überein');
      return;
    }
    if (idStatus.available === false) {
      setError('Login-ID ist nicht verfügbar');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), loginId: loginId.trim(), birthday, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        if (data.suggestion) {
          setLoginIdTouched(true);
          setLoginId(data.suggestion);
        }
        setError(data.error || 'Registrierung fehlgeschlagen');
        return;
      }
      onRegistered?.(data.user);
    } catch (err) {
      setError(err?.message || 'Registrierung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  const idHint = (() => {
    if (idStatus.shapeError) return { text: idStatus.shapeError, ok: false };
    if (idStatus.checking) return { text: 'Prüfe …', ok: null };
    if (!loginId) return { text: 'Wird aus dem Namen abgeleitet.', ok: null };
    if (!loginIdTouched) return { text: 'Vorschlag aus deinem Namen — frei.', ok: null };
    if (idStatus.available === true) return { text: '✓ verfügbar', ok: true };
    if (idStatus.available === false) {
      const sug = idStatus.suggestion && idStatus.suggestion !== loginId ? ` — frei: ${idStatus.suggestion}` : '';
      return { text: `✗ schon vergeben${sug}`, ok: false };
    }
    return { text: '', ok: null };
  })();

  return (
    <div style={backdropStyle} onClick={onBackdropClick} role="dialog" aria-modal="true" aria-label="Registrierung">
      <div style={modalStyle}>
        <button type="button" style={closeBtnStyle} onClick={() => onClose?.()} aria-label="Schließen">
          ×
        </button>
        <h2 style={titleStyle}>Registrieren</h2>
        <p style={subtitleStyle}>
          Dein Name darf alles sein — auch wenn ihn jemand anders schon hat. Die Login-ID
          ist eindeutig und kommt automatisch.
        </p>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>
            <span style={labelTextStyle}>Name</span>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onInput={(e) => setName(e.target.value)}
              placeholder="Name"
              style={inputStyle}
              autoComplete="off"
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Login-ID</span>
            <input
              type="text"
              value={loginId}
              onInput={onIdInput}
              placeholder="randomID"
              style={{
                ...inputStyle,
                fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
              }}
              autoComplete="off"
              spellcheck={false}
            />
            <span
              style={{
                ...hintStyle,
                color:
                  idHint.ok === true
                    ? '#2f7a3e'
                    : idHint.ok === false
                      ? '#b00020'
                      : 'var(--site-soft-muted)',
              }}
            >
              {idHint.text}
            </span>
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Geburtstag (TT-MM)</span>
            <input
              type="text"
              value={birthday}
              onInput={(e) => setBirthday(e.target.value)}
              placeholder="19-03"
              style={inputStyle}
              autoComplete="off"
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Passwort</span>
            <input
              type="password"
              value={password}
              onInput={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Passwort wiederholen</span>
            <input
              type="password"
              value={password2}
              onInput={(e) => setPassword2(e.target.value)}
              style={inputStyle}
            />
          </label>

          {error ? <div style={errStyle}>{error.toUpperCase()}</div> : null}

          <button type="submit" disabled={submitting} style={submitStyle}>
            {submitting ? 'WIRD GESPEICHERT …' : 'KONTO ANLEGEN'}
          </button>
        </form>
      </div>
    </div>
  );
}

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(2px)',
  zIndex: 5000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

const modalStyle = {
  position: 'relative',
  background: 'var(--site-card-bg)',
  color: 'var(--site-body-text)',
  border: '1px solid var(--site-card-border)',
  borderRadius: 12,
  boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
  padding: '1.5rem 1.6rem 1.4rem',
  width: 'min(420px, 100%)',
  maxHeight: 'calc(100vh - 2rem)',
  overflowY: 'auto',
};

const closeBtnStyle = {
  position: 'absolute',
  top: 8,
  right: 12,
  background: 'transparent',
  border: 'none',
  fontSize: '1.6rem',
  lineHeight: 1,
  color: 'var(--site-body-text)',
  cursor: 'pointer',
  padding: 4,
};

const titleStyle = {
  margin: '0 0 0.35rem',
  fontSize: '1.3rem',
  letterSpacing: '0.04em',
};

const subtitleStyle = {
  margin: '0 0 1rem',
  fontSize: '0.82rem',
  opacity: 0.78,
  lineHeight: 1.4,
};

const labelStyle = {
  display: 'block',
  marginBottom: '0.85rem',
};

const labelTextStyle = {
  display: 'block',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  opacity: 0.75,
  marginBottom: 4,
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--site-control-border)',
  background: 'var(--site-control-bg)',
  color: 'var(--site-body-text)',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
};

const hintStyle = {
  display: 'block',
  fontSize: '0.75rem',
  marginTop: 4,
  minHeight: '1.05rem',
};

const submitStyle = {
  width: '100%',
  padding: '10px',
  marginTop: 6,
  borderRadius: 6,
  background: 'var(--site-control-bg-strong)',
  color: 'var(--site-control-fg-strong)',
  border: 'none',
  cursor: 'pointer',
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: '0.08em',
  fontSize: '0.85rem',
};

const errStyle = {
  color: '#b00020',
  marginBottom: 10,
  fontSize: '0.8rem',
  letterSpacing: '0.05em',
};
