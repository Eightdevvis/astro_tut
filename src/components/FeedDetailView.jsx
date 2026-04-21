import { useState } from 'preact/hooks';

/** @param {{ feedId: number; initial: any }} p */
export default function FeedDetailView({ feedId, initial }) {
  const [pins, setPins] = useState(initial?.pins || []);
  const [pinUrl, setPinUrl] = useState('');
  const [pinTitle, setPinTitle] = useState('');
  const [pinNote, setPinNote] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const items = initial?.items || [];
  const summary = initial?.summary;
  const sources = initial?.sources || [];

  async function addPin(e) {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      const body = {
        url: pinUrl.trim(),
        title_override: pinTitle.trim() || undefined,
        note: pinNote.trim() || undefined,
        acknowledge_untrusted: ack || undefined,
      };
      const res = await fetch(`/api/user/feeds/${feedId}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needs_ack) {
          setMsg('Domain nicht auf der Vertrauensliste — unten bestätigen und erneut speichern.');
          return;
        }
        throw new Error(data.error || data.detail || 'Fehler');
      }
      setPinUrl('');
      setPinTitle('');
      setPinNote('');
      setAck(false);
      const r2 = await fetch(`/api/user/feeds/${feedId}/pins`, { credentials: 'same-origin' });
      const d2 = await r2.json();
      if (r2.ok && Array.isArray(d2.pins)) setPins(d2.pins);
      setMsg('Angepinnt.');
    } catch (err) {
      setMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePin(pinId) {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/user/feeds/${feedId}/pins/${pinId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Löschen fehlgeschlagen');
      setPins((prev) => prev.filter((p) => p.id !== pinId));
    } catch (e) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const layout = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '1.25rem',
    marginTop: '1.5rem',
    alignItems: 'start',
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 1rem 3rem' }}>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 600, marginBottom: '0.5rem' }}>{initial?.meta?.title}</h1>
      <p style={{ fontSize: '0.88rem', opacity: 0.78, marginBottom: '1.25rem' }}>{initial?.meta?.user_prompt}</p>

      <section aria-label="Neuigkeiten">
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85 }}>Neu</h2>
        {items.length === 0 ? (
          <p style={{ fontSize: '0.9rem', opacity: 0.75 }}>Noch keine Einträge. Quellen werden regelmäßig abgerufen.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {items.map((it) => (
              <li
                key={it.id}
                style={{
                  marginBottom: '0.85rem',
                  paddingBottom: '0.85rem',
                  borderBottom: '1px solid rgba(0,0,0,0.08)',
                }}
              >
                <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'inherit' }}>
                  {it.title}
                </a>
                {it.summary ? (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', opacity: 0.82 }}>{it.summary}</p>
                ) : null}
                <div style={{ fontSize: '0.72rem', opacity: 0.65, marginTop: 4 }}>
                  Quelle: {it.domain || '—'}
                  {it.published_at ? ` · ${it.published_at}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sources.some((s) => s.last_error) ? (
        <p style={{ fontSize: '0.82rem', color: '#8b2942', marginTop: '1rem' }}>
          Mindestens eine Quelle meldet einen Fehler — bitte URL in den Einstellungen prüfen.
        </p>
      ) : null}

      <div style={layout}>
        <section aria-label="KI-Zusammenfassung">
          <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85 }}>
            Zusammenfassung (KI)
          </h2>
          <p style={{ fontSize: '0.78rem', opacity: 0.75, marginTop: 0 }}>
            Keine Rechts-, Medizin- oder Anlageberatung. Inhalte stammen von Drittseiten — bitte dort verifizieren.
          </p>
          {summary?.body_md ? (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5 }}>{summary.body_md}</div>
          ) : (
            <p style={{ fontSize: '0.88rem', opacity: 0.75 }}>Noch keine Zusammenfassung (nach Ingest und KI-Lauf).</p>
          )}
        </section>

        <section aria-label="Angepinnt">
          <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85 }}>
            Angepinnt
          </h2>
          <ul style={{ margin: '0 0 1rem', padding: 0, listStyle: 'none' }}>
            {pins.map((p) => (
              <li key={p.id} style={{ marginBottom: 10, fontSize: '0.88rem' }}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>
                  {p.title_override || p.url}
                </a>
                {p.note ? <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>{p.note}</div> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removePin(p.id)}
                  style={{
                    marginTop: 4,
                    fontSize: '0.72rem',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  Pin entfernen
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addPin} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: '0.78rem', opacity: 0.85 }}>
              URL (https)
              <input
                value={pinUrl}
                onInput={(e) => setPinUrl(e.currentTarget.value)}
                required
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 6, boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ fontSize: '0.78rem', opacity: 0.85 }}>
              Titel (optional)
              <input
                value={pinTitle}
                onInput={(e) => setPinTitle(e.currentTarget.value)}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 6, boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ fontSize: '0.78rem', opacity: 0.85 }}>
              Notiz (optional)
              <input
                value={pinNote}
                onInput={(e) => setPinNote(e.currentTarget.value)}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 6, boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.currentTarget.checked)} />
              Ich bestätige eine Quelle außerhalb der Vertrauensliste (selbst verantwortlich).
            </label>
            <button
              type="submit"
              disabled={busy}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)', cursor: 'pointer' }}
            >
              {busy ? '…' : 'Pin hinzufügen'}
            </button>
          </form>
          {msg ? <p style={{ fontSize: '0.82rem', marginTop: 8 }}>{msg}</p> : null}
        </section>
      </div>
    </div>
  );
}
