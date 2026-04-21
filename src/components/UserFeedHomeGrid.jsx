import { useState, useEffect } from 'preact/hooks';

const wrap = {
  minWidth: 'min(100%, 280px)',
  maxWidth: '100%',
  padding: '0.75rem',
  boxSizing: 'border-box',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.5)',
};

const tabs = { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' };
const tab = (on) => ({
  padding: '6px 10px',
  borderRadius: 6,
  border: on ? '1px solid rgba(0,0,0,0.4)' : '1px solid rgba(0,0,0,0.15)',
  background: on ? 'rgba(0,0,0,0.08)' : 'transparent',
  cursor: 'pointer',
  fontSize: '0.72rem',
  fontWeight: on ? 700 : 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
});

const linkOut = {
  display: 'block',
  fontSize: '0.82rem',
  marginBottom: 6,
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

function shortTabLabel(title) {
  const t = String(title || '').trim();
  if (t.length <= 22) return t;
  return `${t.slice(0, 19)}…`;
}

export default function UserFeedHomeGrid() {
  const [feeds, setFeeds] = useState([]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const u = await fetch('/api/user', { credentials: 'same-origin' });
        if (!u.ok) {
          if (!c) setLoading(false);
          return;
        }
        const res = await fetch('/api/user/feeds?preview=1', { credentials: 'same-origin' });
        if (!res.ok) {
          if (!c) setErr('Feeds konnten nicht geladen werden.');
          return;
        }
        const data = await res.json();
        if (!c) setFeeds(Array.isArray(data.feeds) ? data.feeds : []);
      } catch {
        if (!c) setErr('Netzwerkfehler.');
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  if (loading) return null;
  if (err || feeds.length === 0) return null;

  const idx = Math.min(active, Math.max(0, feeds.length - 1));
  const f = feeds[idx];
  const preview = f?.preview || [];

  return (
    <div style={wrap} class="grid-item grid-item--topic-feeds" aria-label="Themen-Feeds">
      <div style={tabs}>
        {feeds.map((feed, i) => (
          <button key={feed.id} type="button" style={tab(i === idx)} onClick={() => setActive(i)}>
            {shortTabLabel(feed.title)}
          </button>
        ))}
        <a href="/settings" style={{ ...tab(false), textDecoration: 'none', color: 'inherit', marginLeft: 'auto' }}>
          +
        </a>
      </div>
      {preview.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.75 }}>Noch keine Einträge — Ingest läuft periodisch.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {preview.map((p) => (
            <li
              key={p.url}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}
            >
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt=""
                  width={40}
                  height={28}
                  style={{
                    objectFit: 'cover',
                    borderRadius: 4,
                    flexShrink: 0,
                    marginTop: 2,
                    background: 'rgba(0,0,0,0.06)',
                  }}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...linkOut, marginBottom: 0, flex: 1, minWidth: 0 }}
              >
                {p.title || p.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      <a
        href={`/feeds/${f.id}`}
        style={{ display: 'inline-block', marginTop: 8, fontSize: '0.78rem', letterSpacing: '0.06em', opacity: 0.85 }}
      >
        Alle anzeigen →
      </a>
    </div>
  );
}
