import { useState } from 'preact/hooks';

/**
 * Überschrift: bevorzugt Stichwörter aus dem gespeicherten Plan, sonst erste Zeile der Nutzereingabe;
 * vermeidet lange KI-Formulierungen wie „Der Nutzer interessiert sich …“ als H1.
 * @param {{ title?: string; user_prompt?: string; ai_plan_json?: string }} meta
 */
function pickFeedHeadline(meta) {
  let plan = {};
  try {
    plan = JSON.parse(String(meta?.ai_plan_json || '{}'));
  } catch {
    plan = {};
  }
  const kw = Array.isArray(plan.keywords) ? plan.keywords.map((x) => String(x).trim()).filter(Boolean) : [];
  if (kw.length) {
    const s = kw.slice(0, 5).join(' · ');
    return s.length > 88 ? `${s.slice(0, 85)}…` : s;
  }
  const rawTitle = String(meta?.title || '').trim();
  const promptFirst = String(meta?.user_prompt || '')
    .trim()
    .split(/\n+/)[0]
    .trim();
  const looksLikeAiNarration = /^der nutzer /i.test(rawTitle) || /^die nutzerin /i.test(rawTitle);
  if (looksLikeAiNarration && promptFirst) {
    return promptFirst.length > 88 ? `${promptFirst.slice(0, 85)}…` : promptFirst;
  }
  if (rawTitle.length > 88) return `${rawTitle.slice(0, 85)}…`;
  if (rawTitle) return rawTitle;
  if (promptFirst) return promptFirst.length > 88 ? `${promptFirst.slice(0, 85)}…` : promptFirst;
  return 'Feed';
}

const newsScrollBox = {
  maxHeight: 'min(52vh, 440px)',
  overflowY: 'auto',
  overflowX: 'hidden',
  WebkitOverflowScrolling: 'touch',
  marginTop: 8,
  padding: '10px 12px',
  border: '1px solid rgba(0,0,0,0.1)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.35)',
  overscrollBehavior: 'contain',
};

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
  const meta = initial?.meta || {};
  const headline = pickFeedHeadline(meta);
  let understoodFromPlan = '';
  try {
    const p = JSON.parse(String(meta.ai_plan_json || '{}'));
    if (typeof p.understood === 'string' && p.understood.trim()) understoodFromPlan = p.understood.trim();
  } catch {
    /* ignore */
  }

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
      <h1 style={{ fontSize: '1.35rem', fontWeight: 600, marginBottom: '0.35rem', lineHeight: 1.25 }}>{headline}</h1>
      {meta.user_prompt ? (
        <p style={{ fontSize: '0.88rem', opacity: 0.78, marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
            Deine Eingabe
          </span>
          <br />
          {String(meta.user_prompt).trim()}
        </p>
      ) : null}
      {understoodFromPlan && understoodFromPlan !== headline ? (
        <details style={{ fontSize: '0.82rem', opacity: 0.8, marginBottom: '1rem' }}>
          <summary style={{ cursor: 'pointer' }}>KI-Überblick (ausführlicher)</summary>
          <p style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap' }}>{understoodFromPlan}</p>
        </details>
      ) : null}

      <section aria-label="Neuigkeiten">
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85 }}>Neu</h2>
        {items.length === 0 ? (
          <p style={{ fontSize: '0.9rem', opacity: 0.75 }}>Noch keine Einträge. Quellen werden regelmäßig abgerufen.</p>
        ) : (
          <div style={newsScrollBox} tabindex={0} role="region" aria-label="Neue Artikel, scrollbar">
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
          </div>
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
