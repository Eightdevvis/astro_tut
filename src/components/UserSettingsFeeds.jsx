import { useState, useEffect } from 'preact/hooks';

const muted = { fontSize: '0.85rem', opacity: 0.75, marginBottom: 8 };
const errStyle = { color: 'crimson', marginBottom: 12, fontSize: '0.9rem' };
const box = { border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '1rem', marginBottom: 12, background: 'rgba(255,255,255,0.45)' };

/** Kurzer Feed-Titel: topic_anchor > Stichwörter > erste Zeile Prompt. */
function defaultFeedTitle(plan, userPrompt) {
  const anchor = String(plan?.topic_anchor || '').trim();
  if (anchor) {
    const first = anchor.split(/\n+/)[0].trim();
    const sentence = /[.!?]\s/.test(first) ? first.split(/(?<=[.!?])\s+/)[0].trim() : first;
    const use = sentence.length > 72 ? `${sentence.slice(0, 69)}…` : sentence;
    if (use.length >= 4) return use;
  }
  const kw = Array.isArray(plan?.keywords) ? plan.keywords.map((x) => String(x).trim()).filter(Boolean) : [];
  if (kw.length) {
    const s = kw.slice(0, 5).join(', ');
    if (s.length <= 80) return s;
    return `${s.slice(0, 77)}…`;
  }
  const line = String(userPrompt || '')
    .trim()
    .split(/\n+/)[0]
    .trim();
  if (line) return line.length > 72 ? `${line.slice(0, 72)}…` : line;
  return 'Mein Feed';
}

export default function UserSettingsFeeds() {
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState('prompt');
  const [prompt, setPrompt] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [planErr, setPlanErr] = useState('');
  const [plan, setPlan] = useState(null);
  const [title, setTitle] = useState('');
  const [confirmUrls, setConfirmUrls] = useState(() => new Set());
  const [saveBusy, setSaveBusy] = useState(false);

  async function loadFeeds() {
    setErr('');
    try {
      const res = await fetch('/api/user/feeds', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Feeds laden fehlgeschlagen');
      const data = await res.json();
      setFeeds(Array.isArray(data.feeds) ? data.feeds : []);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeeds();
  }, []);

  function openModal() {
    setModal(true);
    setStep('prompt');
    setPrompt('');
    setPlan(null);
    setPlanErr('');
    setTitle('');
    setConfirmUrls(new Set());
  }

  async function runPlan() {
    setPlanBusy(true);
    setPlanErr('');
    try {
      const res = await fetch('/api/user/feeds/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.detail || 'Plan fehlgeschlagen');
      setPlan(data);
      setTitle(defaultFeedTitle(data, prompt));
      setConfirmUrls(new Set());
      const autoN = (data.rss_classified_auto || []).length;
      const needN = (data.rss_classified_needs_confirm || []).length;
      if (autoN === 0 && needN === 0) {
        setPlanErr('Keine gültigen RSS-URLs im Vorschlag — bitte Thema präzisieren oder erneut versuchen.');
        return;
      }
      setStep('confirm');
    } catch (e) {
      setPlanErr(e?.message || String(e));
    } finally {
      setPlanBusy(false);
    }
  }

  function toggleConfirmUrl(url) {
    const next = new Set(confirmUrls);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setConfirmUrls(next);
  }

  async function saveFeed() {
    if (!plan) return;
    const auto = (plan.rss_classified_auto || []).map((x) => ({
      url: x.url,
      added_by: 'ai',
      user_confirmed: false,
    }));
    const needs = plan.rss_classified_needs_confirm || [];
    const extra = needs
      .filter((n) => confirmUrls.has(n.url))
      .map((n) => ({ url: n.url, added_by: 'ai', user_confirmed: true }));
    const sources = [...auto, ...extra];
    if (sources.length === 0) {
      setPlanErr('Mindestens eine RSS-Quelle auswählen oder bestätigen.');
      return;
    }
    setSaveBusy(true);
    setPlanErr('');
    try {
      const res = await fetch('/api/user/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: title.trim(),
          user_prompt: prompt.trim(),
          ai_plan_json: {
            topic_anchor: plan.topic_anchor,
            understood: plan.understood,
            drift_guard: plan.drift_guard,
            keywords: plan.keywords,
            rationale: plan.rationale,
            deep_links: plan.deep_links,
          },
          sources,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
      setModal(false);
      await loadFeeds();
    } catch (e) {
      setPlanErr(e?.message || String(e));
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteFeed(id) {
    if (!confirm('Diesen Feed wirklich löschen?')) return;
    try {
      const res = await fetch(`/api/user/feeds/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error('Löschen fehlgeschlagen');
      await loadFeeds();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2
        style={{
          fontSize: '1.1rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '1rem',
          opacity: 0.85,
        }}
      >
        Topic-Feeds
      </h2>
      <p style={muted}>
        Themen aus verlässlichen RSS-Quellen (Allowlist). KI schlägt Feeds vor — Quellen außerhalb der Liste musst du
        ausdrücklich bestätigen.
      </p>
      {err ? <div style={errStyle}>{err}</div> : null}
      <button
        type="button"
        onClick={openModal}
        style={{
          padding: '10px 16px',
          borderRadius: 6,
          border: '1px solid rgba(0,0,0,0.25)',
          background: 'rgba(255,255,255,0.65)',
          cursor: 'pointer',
          marginBottom: 16,
          fontWeight: 600,
        }}
      >
        + Feed hinzufügen
      </button>
      {loading ? <p style={muted}>Laden…</p> : null}
      {!loading && feeds.length === 0 ? <p style={muted}>Noch keine Feeds.</p> : null}
      {!loading &&
        feeds.map((f) => (
          <div key={f.id} style={box}>
            <strong>{f.title && f.title.length > 56 ? `${f.title.slice(0, 53)}…` : f.title}</strong>
            <p style={{ ...muted, marginBottom: 8 }}>{f.user_prompt?.slice(0, 200)}{f.user_prompt?.length > 200 ? '…' : ''}</p>
            <a href={`/feeds/${f.id}`} style={{ marginRight: 12, fontSize: '0.9rem' }}>
              Öffnen
            </a>
            <button
              type="button"
              onClick={() => deleteFeed(f.id)}
              style={{ fontSize: '0.85rem', border: 'none', background: 'transparent', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Löschen
            </button>
          </div>
        ))}

      {modal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            boxSizing: 'border-box',
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Neuer Feed"
        >
          <div
            style={{
              background: 'var(--home-page-bg, #f4f1ea)',
              maxWidth: 520,
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              borderRadius: 10,
              padding: '1.25rem',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <button
              type="button"
              onClick={() => setModal(false)}
              style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.2rem' }}
              aria-label="Schließen"
            >
              ×
            </button>
            {step === 'prompt' ? (
              <>
                <h3 style={{ marginTop: 0 }}>Thema beschreiben</h3>
                <textarea
                  value={prompt}
                  onInput={(e) => setPrompt(e.currentTarget.value)}
                  rows={6}
                  style={{ width: '100%', boxSizing: 'border-box', padding: 8, marginBottom: 12 }}
                  placeholder="z. B. 3D-Displays, Light Field, kommerzielle Prototypen…"
                />
                {planErr ? <div style={errStyle}>{planErr}</div> : null}
                <button type="button" disabled={planBusy || !prompt.trim()} onClick={runPlan} style={{ padding: '8px 14px', cursor: 'pointer' }}>
                  {planBusy ? 'KI denkt…' : 'KI-Vorschlag holen'}
                </button>
              </>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>Vorschlag prüfen</h3>
                {plan?.topic_anchor ? (
                  <>
                    <p style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7, marginBottom: 4 }}>
                      Themen-Anker
                    </p>
                    <p style={{ fontSize: '0.95rem', marginTop: 0, marginBottom: 10 }}>{plan.topic_anchor}</p>
                  </>
                ) : null}
                <p style={{ fontSize: '0.88rem', marginBottom: 8 }}>
                  <strong>Kurzfassung:</strong> {plan?.understood}
                </p>
                {(plan?.drift_guard || []).length > 0 ? (
                  <details style={{ fontSize: '0.82rem', marginBottom: 10 }}>
                    <summary style={{ cursor: 'pointer' }}>Nicht-Ziele (soll der Feed nicht verlassen)</summary>
                    <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                      {plan.drift_guard.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {plan?.rationale ? <p style={muted}>{plan.rationale}</p> : null}
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.88rem' }}>
                  Kurztitel (Tabs und Navigation)
                  <input
                    value={title}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: 6, boxSizing: 'border-box' }}
                  />
                </label>
                <p style={{ ...muted, marginTop: 0, marginBottom: 12 }}>
                  Vorschlag aus Stichwörtern — bei Bedarf kürzen. Die ausführliche KI-Formulierung bleibt im
                  KI-Überblick auf der Feed-Seite.
                </p>
                <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>Automatische Quellen (Allowlist)</p>
                <ul style={{ fontSize: '0.85rem' }}>
                  {(plan?.rss_classified_auto || []).map((x) => (
                    <li key={x.url}>{x.url}</li>
                  ))}
                </ul>
                {(plan?.rss_classified_needs_confirm || []).length > 0 ? (
                  <>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>Bestätigung nötig</p>
                    <ul style={{ listStyle: 'none', padding: 0, fontSize: '0.85rem' }}>
                      {plan.rss_classified_needs_confirm.map((n) => (
                        <li key={n.url} style={{ marginBottom: 8 }}>
                          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <input type="checkbox" checked={confirmUrls.has(n.url)} onChange={() => toggleConfirmUrl(n.url)} />
                            <span>
                              {n.url}
                              <br />
                              <span style={{ opacity: 0.75 }}>{n.reason}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {(plan?.deep_links || []).length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>Deep Links (nur Hinweis, nicht als RSS gespeichert)</p>
                    <ul style={{ fontSize: '0.82rem' }}>
                      {plan.deep_links.map((d) => (
                        <li key={d.url}>
                          <a href={d.url} target="_blank" rel="noopener noreferrer">
                            {d.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {planErr ? <div style={errStyle}>{planErr}</div> : null}
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button type="button" onClick={() => setStep('prompt')} style={{ padding: '8px 12px' }}>
                    Zurück
                  </button>
                  <button type="button" disabled={saveBusy} onClick={saveFeed} style={{ padding: '8px 12px', fontWeight: 600 }}>
                    {saveBusy ? 'Speichere…' : 'Feed anlegen'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
