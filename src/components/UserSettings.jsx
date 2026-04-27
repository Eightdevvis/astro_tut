import { useState, useEffect, useRef } from 'preact/hooks';
import UserSettingsFeeds from './UserSettingsFeeds.jsx';

const FGRAFFITI_HOTKEY_STORAGE_KEY = 'fgraffiti.hotkey';
const FGRAFFITI_DEFAULT_HOTKEY = ['Enter', '1'];

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
const fieldInput = {
  padding: '9px 11px',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.2)',
  background: 'rgba(255,255,255,0.82)',
};

function normalizeGraffitiKey(value) {
  if (!value) return '';
  if (value === ' ') return 'Space';
  if (value === 'Esc') return 'Escape';
  if (value.length === 1) return value.toUpperCase();
  return value;
}

function loadGraffitiHotkey() {
  if (typeof localStorage === 'undefined') return FGRAFFITI_DEFAULT_HOTKEY;
  try {
    const raw = localStorage.getItem(FGRAFFITI_HOTKEY_STORAGE_KEY);
    if (!raw) return FGRAFFITI_DEFAULT_HOTKEY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2) return FGRAFFITI_DEFAULT_HOTKEY;
    const clean = parsed.map((k) => normalizeGraffitiKey(String(k))).filter(Boolean);
    if (clean.length < 2) return FGRAFFITI_DEFAULT_HOTKEY;
    return clean.slice(0, 2);
  } catch {
    return FGRAFFITI_DEFAULT_HOTKEY;
  }
}

function formatNum(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('de-DE').format(n);
}

function formatCost(c) {
  if (c == null || Number.isNaN(c)) return '—';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6 }).format(c);
}

function formatBerlinTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const looksSqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw);
  const normalized = hasExplicitZone ? raw : looksSqlUtc ? `${raw.replace(' ', 'T')}Z` : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed);
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
  const [userLoading, setUserLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(true);
  const [testerUiEnabled, setTesterUiEnabled] = useState(true);
  const [testerBusy, setTesterBusy] = useState(false);
  const [testerMsg, setTesterMsg] = useState('');
  const [graffitiHotkey, setGraffitiHotkey] = useState(() => FGRAFFITI_DEFAULT_HOTKEY);
  const [graffitiMsg, setGraffitiMsg] = useState('');
  const [rpgBackups, setRpgBackups] = useState([]);
  const [rpgBackupsLoading, setRpgBackupsLoading] = useState(false);
  const [rpgBackupsBusyId, setRpgBackupsBusyId] = useState(0);
  const [rpgBackupMsg, setRpgBackupMsg] = useState('');
  const settingsLoadGen = useRef(0);

  useEffect(() => {
    const gen = ++settingsLoadGen.current;
    let cancelled = false;
    setErr('');

    (async () => {
      try {
        const res = await fetch('/api/user/ai-usage', { credentials: 'same-origin' });
        const data = res.ok ? await res.json().catch(() => ({})) : null;
        if (!cancelled && gen === settingsLoadGen.current) {
          if (res.ok) setAi(data);
          else setAi({ features: [], totals: {}, recent: [] });
        }
      } catch {
        if (!cancelled && gen === settingsLoadGen.current) setAi({ features: [], totals: {}, recent: [] });
      } finally {
        if (!cancelled && gen === settingsLoadGen.current) setAiLoading(false);
      }
    })();

    (async () => {
      try {
        const uRes = await fetch('/api/user', { credentials: 'same-origin' });
        const uData = uRes.ok ? await uRes.json().catch(() => ({})) : null;
        if (!uRes.ok) {
          if (!cancelled && gen === settingsLoadGen.current) setErr('Sitzung ungültig — bitte neu anmelden.');
          return;
        }
        if (!cancelled && gen === settingsLoadGen.current) {
          setUser(uData.user);
          setTesterUiEnabled(Boolean(uData?.user?.testerUiEnabled));
        }
      } catch {
        if (!cancelled && gen === settingsLoadGen.current) setErr('Daten konnten nicht geladen werden.');
      } finally {
        if (!cancelled && gen === settingsLoadGen.current) setUserLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setGraffitiHotkey(loadGraffitiHotkey());
  }, []);

  useEffect(() => {
    if (tab !== 'rpg') return;
    if (!user?.canUseRpg) return;
    let cancelled = false;
    (async () => {
      setRpgBackupsLoading(true);
      setRpgBackupMsg('');
      try {
        const res = await fetch('/api/rpg/quests-backups', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Backups konnten nicht geladen werden.');
        if (!cancelled) {
          const backups = Array.isArray(data.backups) ? data.backups : [];
          setRpgBackups(backups);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Backups konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setRpgBackupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, user?.canUseRpg]);

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

      {!userLoading && user ? (
        <div style={tabRow}>
          <TabButton id="account" label="Konto" active={tab === 'account'} onPick={setTab} />
          {user.canUseFeeds ? <TabButton id="feeds" label="Feed" active={tab === 'feeds'} onPick={setTab} /> : null}
          <TabButton id="ai" label="KI-Nutzung" active={tab === 'ai'} onPick={setTab} />
          <TabButton id="fgraffiti" label="fgraffiti" active={tab === 'fgraffiti'} onPick={setTab} />
          {user.canUseRpg ? <TabButton id="rpg" label="RPG" active={tab === 'rpg'} onPick={setTab} /> : null}
          {user.isTester ? (
            <TabButton id="tester" label="Tester" active={tab === 'tester'} onPick={setTab} />
          ) : null}
        </div>
      ) : null}

      {err ? <div style={errStyle}>{err}</div> : null}
      {userLoading ? <p style={muted}>Laden…</p> : null}

      {!userLoading && tab === 'account' && user && (
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

      {!userLoading && tab === 'feeds' && user?.canUseFeeds && <UserSettingsFeeds />}

      {!userLoading && tab === 'ai' && aiLoading ? <p style={muted}>KI-Nutzung wird geladen…</p> : null}

      {!userLoading && tab === 'ai' && !aiLoading && ai && (
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

      {!userLoading && tab === 'fgraffiti' && (
        <section style={section}>
          <h2 style={h2}>fgraffiti</h2>
          <p style={muted}>
            have fun and do good shenaningang time. i will implement jailtime maybe later so dont get caught.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, maxWidth: 460 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: '0.75rem', letterSpacing: '0.06em', opacity: 0.75 }}>Taste 1</span>
              <input
                value={graffitiHotkey[0] || ''}
                onInput={(e) => {
                  setGraffitiMsg('');
                  const next = normalizeGraffitiKey(e.currentTarget.value.trim());
                  setGraffitiHotkey((prev) => [next, prev[1] || '']);
                }}
                style={fieldInput}
                placeholder="z. B. Enter"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: '0.75rem', letterSpacing: '0.06em', opacity: 0.75 }}>Taste 2</span>
              <input
                value={graffitiHotkey[1] || ''}
                onInput={(e) => {
                  setGraffitiMsg('');
                  const next = normalizeGraffitiKey(e.currentTarget.value.trim());
                  setGraffitiHotkey((prev) => [prev[0] || '', next]);
                }}
                style={fieldInput}
                placeholder="z. B. 1"
              />
            </label>
          </div>
          <p style={{ ...muted, marginTop: 8, maxWidth: 520 }}>
            Taste 1+2 zusammen: erstes Mal öffnet den Stift (Tag). Jeder weitere Kord: Spray → Schwamm → wieder zu. Derselbe Hotkey durchcyclt die Palette.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => {
                const a = normalizeGraffitiKey(graffitiHotkey[0] || '');
                const b = normalizeGraffitiKey(graffitiHotkey[1] || '');
                if (!a || !b) {
                  setGraffitiMsg('Bitte zwei gueltige Tasten setzen.');
                  return;
                }
                const next = [a, b];
                localStorage.setItem(FGRAFFITI_HOTKEY_STORAGE_KEY, JSON.stringify(next));
                window.dispatchEvent(new Event('fgraffiti-hotkey-change'));
                setGraffitiHotkey(next);
                setGraffitiMsg(`Gespeichert: ${next[0]} + ${next[1]} (Palette: Tag → Spray → Schwamm → aus)`);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.2)',
                background: 'rgba(255,255,255,0.65)',
                cursor: 'pointer',
              }}
            >
              Hotkey speichern
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(FGRAFFITI_HOTKEY_STORAGE_KEY, JSON.stringify(FGRAFFITI_DEFAULT_HOTKEY));
                window.dispatchEvent(new Event('fgraffiti-hotkey-change'));
                setGraffitiHotkey(FGRAFFITI_DEFAULT_HOTKEY);
                setGraffitiMsg('Zurueckgesetzt auf Enter + 1.');
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.2)',
                background: 'rgba(255,255,255,0.65)',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
          {graffitiMsg ? <p style={{ ...muted, marginTop: 10 }}>{graffitiMsg}</p> : null}
        </section>
      )}

      {!userLoading && tab === 'tester' && user?.isTester && (
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

      {!userLoading && tab === 'rpg' && user?.canUseRpg && (
        <section style={section}>
          <h2 style={h2}>RPG Backups</h2>
          <p style={muted}>
            Pro RPG-Speicheraktion wird automatisch doppelt gesichert. Diese Liste lädt nur auf diesem Tab, damit
            das normale Einstellungs-Laden leicht bleibt.
          </p>
          {rpgBackupsLoading ? <p style={muted}>Backups laden…</p> : null}
          {!rpgBackupsLoading && rpgBackups.length === 0 ? (
            <p style={muted}>Noch keine Backups vorhanden.</p>
          ) : null}
          {!rpgBackupsLoading && rpgBackups.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thtd}>Zeit (Deutschland)</th>
                    <th style={thtd}>Typ</th>
                    <th style={thtd}>Größe</th>
                    <th style={thtd}>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {rpgBackups.map((b) => (
                    <tr key={b.id}>
                      <td style={thtd}>{formatBerlinTime(b.created_at)}</td>
                      <td style={thtd}>{b.kind}</td>
                      <td style={thtd}>{formatNum(b.payload_bytes)} B</td>
                      <td style={thtd}>
                        <button
                          type="button"
                          disabled={rpgBackupsBusyId === b.id}
                          onClick={async () => {
                            setErr('');
                            setRpgBackupMsg('');
                            const ok = window.confirm(
                              'Backup wirklich wiederherstellen? Der aktuelle RPG-Stand wird davor erneut gesichert.'
                            );
                            if (!ok) return;
                            setRpgBackupsBusyId(b.id);
                            try {
                              const res = await fetch('/api/rpg/quests-backups', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'same-origin',
                                body: JSON.stringify({ backupId: b.id }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(data.error || 'Restore fehlgeschlagen.');
                              setRpgBackupMsg(`Backup #${b.id} wiederhergestellt.`);
                              const listRes = await fetch('/api/rpg/quests-backups', { credentials: 'same-origin' });
                              const listData = await listRes.json().catch(() => ({}));
                              if (listRes.ok && Array.isArray(listData.backups)) setRpgBackups(listData.backups);
                            } catch (e) {
                              setErr(e?.message || 'Restore fehlgeschlagen.');
                            } finally {
                              setRpgBackupsBusyId(0);
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid rgba(0,0,0,0.2)',
                            background: 'rgba(255,255,255,0.65)',
                            cursor: 'pointer',
                          }}
                        >
                          {rpgBackupsBusyId === b.id ? 'Restore…' : 'Wiederherstellen'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {rpgBackupMsg ? <p style={{ ...muted, marginTop: 10 }}>{rpgBackupMsg}</p> : null}
        </section>
      )}
    </div>
  );
}
