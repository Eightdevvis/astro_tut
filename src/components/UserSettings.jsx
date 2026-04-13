import { useState, useEffect } from 'preact/hooks';

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

const tabRow = {
  display: 'flex',
  gap: 8,
  marginBottom: '1.5rem',
  flexWrap: 'wrap',
};

const tabBtn = (active) => ({
  padding: '10px 16px',
  borderRadius: 6,
  border: active ? '1px solid rgba(0,0,0,0.45)' : '1px solid rgba(0,0,0,0.2)',
  background: active ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: '0.8rem',
  fontWeight: 600,
});

const errStyle = { color: 'crimson', marginBottom: 12, fontSize: '0.9rem' };
const muted = { fontSize: '0.85rem', opacity: 0.75, marginBottom: 8 };

function formatNum(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('de-DE').format(n);
}

function formatCost(c) {
  if (c == null || Number.isNaN(c)) return '—';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6 }).format(c);
}

/** @param {{ id: string; label: string }} p */
function TabButton({ id, label, active, onPick }) {
  return (
    <button type="button" style={tabBtn(active)} onClick={() => onPick(id)}>
      {label}
    </button>
  );
}

export default function UserSettings() {
  const [tab, setTab] = useState('account');
  const [user, setUser] = useState(null);
  const [ai, setAi] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [testerUiEnabled, setTesterUiEnabled] = useState(true);
  const [testerBusy, setTesterBusy] = useState(false);
  const [testerMsg, setTesterMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr('');
      setLoading(true);
      try {
        const [uRes, aiRes] = await Promise.all([
          fetch('/api/user', { credentials: 'same-origin' }),
          fetch('/api/user/ai-usage', { credentials: 'same-origin' }),
        ]);
        if (!uRes.ok) {
          if (!cancelled) setErr('Sitzung ungültig — bitte neu anmelden.');
          return;
        }
        const uData = await uRes.json();
        if (!cancelled) {
          setUser(uData.user);
          setTesterUiEnabled(Boolean(uData?.user?.testerUiEnabled));
        }
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          if (!cancelled) setAi(aiData);
        } else if (!cancelled) setAi({ features: [], totals: {}, recent: [] });
      } catch {
        if (!cancelled) setErr('Daten konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={box}>
      <h1
        style={{
          fontSize: '1.5rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: '1.25rem',
        }}
      >
        Einstellungen
      </h1>

      <div style={tabRow}>
        <TabButton id="account" label="Konto" active={tab === 'account'} onPick={setTab} />
        <TabButton id="ai" label="KI-Nutzung" active={tab === 'ai'} onPick={setTab} />
        {user?.isTester ? (
          <TabButton id="tester" label="Tester" active={tab === 'tester'} onPick={setTab} />
        ) : null}
      </div>

      {err ? <div style={errStyle}>{err}</div> : null}
      {loading ? <p style={muted}>Laden…</p> : null}

      {!loading && tab === 'account' && user && (
        <section style={section}>
          <h2 style={h2}>Konto</h2>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ display: 'block', fontSize: '0.75rem', letterSpacing: '0.06em', opacity: 0.75 }}>
              Nutzername
            </strong>
            {user.username}
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong style={{ display: 'block', fontSize: '0.75rem', letterSpacing: '0.06em', opacity: 0.75 }}>
              Geburtstag
            </strong>
            {user.birthday}
          </p>
        </section>
      )}

      {!loading && tab === 'ai' && ai && (
        <>
          <section style={section}>
            <h2 style={h2}>Gesamt</h2>
            <p style={muted}>
              Erfasst werden serverseitige Modellaufrufe (Token und — falls der Anbieter sie liefert —
              Kosten). Pro Bereich der Website siehe unten.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thtd}>Anfragen</th>
                  <th style={thtd}>Prompt-Tokens</th>
                  <th style={thtd}>Completion-Tokens</th>
                  <th style={thtd}>Summe Tokens</th>
                  <th style={thtd}>Kosten (falls gemeldet)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={thtd}>{formatNum(ai.totals?.requests)}</td>
                  <td style={thtd}>{formatNum(ai.totals?.prompt_tokens)}</td>
                  <td style={thtd}>{formatNum(ai.totals?.completion_tokens)}</td>
                  <td style={thtd}>{formatNum(ai.totals?.total_tokens)}</td>
                  <td style={thtd}>{formatCost(ai.totals?.cost_sum)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section style={section}>
            <h2 style={h2}>Nach Bereich</h2>
            {(!ai.features || ai.features.length === 0) ? (
              <p style={muted}>Noch keine erfasste KI-Nutzung.</p>
            ) : (
              ai.features.map((f) => (
                <div
                  key={f.feature}
                  style={{
                    marginBottom: '1.75rem',
                    padding: '1rem 1.1rem',
                    borderRadius: 8,
                    border: '1px solid rgba(0,0,0,0.12)',
                    background: 'rgba(255,255,255,0.45)',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1rem',
                      marginTop: 0,
                      marginBottom: '0.75rem',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {f.label}
                  </h3>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thtd}>Anfragen</th>
                        <th style={thtd}>Prompt</th>
                        <th style={thtd}>Completion</th>
                        <th style={thtd}>Summe</th>
                        <th style={thtd}>Kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={thtd}>{formatNum(f.requests)}</td>
                        <td style={thtd}>{formatNum(f.prompt_tokens)}</td>
                        <td style={thtd}>{formatNum(f.completion_tokens)}</td>
                        <td style={thtd}>{formatNum(f.total_tokens)}</td>
                        <td style={thtd}>{formatCost(f.cost_sum)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </section>

          <section style={section}>
            <h2 style={h2}>Letzte Aufrufe</h2>
            {(!ai.recent || ai.recent.length === 0) ? (
              <p style={muted}>Keine Einträge.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thtd}>Zeit (UTC)</th>
                      <th style={thtd}>Bereich</th>
                      <th style={thtd}>Modell</th>
                      <th style={thtd}>Tokens</th>
                      <th style={thtd}>Kosten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ai.recent.map((r) => (
                      <tr key={r.id}>
                        <td style={thtd}>{r.created_at}</td>
                        <td style={thtd}>{r.label}</td>
                        <td style={thtd}>{r.model}</td>
                        <td style={thtd}>{formatNum(r.total_tokens)}</td>
                        <td style={thtd}>{formatCost(r.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!loading && tab === 'tester' && user?.isTester && (
        <section style={section}>
          <h2 style={h2}>Testeroberfläche</h2>
          <p style={muted}>
            Hier kannst du nur die Sichtbarkeit deiner Testerleiste steuern. Dein Testerstatus bleibt unverändert.
          </p>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
              fontSize: '0.95rem',
            }}
          >
            <input
              type="checkbox"
              checked={testerUiEnabled}
              onChange={(e) => setTesterUiEnabled(e.currentTarget.checked)}
              disabled={testerBusy}
            />
            Testerleiste unten anzeigen
          </label>
          <button
            type="button"
            onClick={async () => {
              setTesterBusy(true);
              setTesterMsg('');
              setErr('');
              try {
                const res = await fetch('/api/user/tester-ui', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin',
                  body: JSON.stringify({ enabled: testerUiEnabled }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
                setTesterMsg(testerUiEnabled ? 'Testeroberfläche aktiviert.' : 'Testeroberfläche deaktiviert.');
                setUser((prev) => (prev ? { ...prev, testerUiEnabled } : prev));
              } catch (e) {
                setErr(e?.message || 'Speichern fehlgeschlagen.');
              } finally {
                setTesterBusy(false);
              }
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.2)',
              background: 'rgba(255,255,255,0.65)',
              cursor: 'pointer',
            }}
            disabled={testerBusy}
          >
            {testerBusy ? 'Speichere…' : 'Speichern'}
          </button>
          {testerMsg ? <p style={{ ...muted, marginTop: 10 }}>{testerMsg}</p> : null}
        </section>
      )}
    </div>
  );
}
