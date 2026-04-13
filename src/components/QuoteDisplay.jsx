import { useState, useEffect } from 'preact/hooks';

/**
 * QuoteDisplay.jsx
 * Zeigt ein zufällig ausgewähltes Zitat aus der DB.
 * Fetcht beim Laden von GET /api/quotes/random.
 * Kein Login nötig — Zitate sind öffentlich.
 */
function QuoteDisplay() {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch('/api/quotes/random')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setQuote(data.quote ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Zitate konnten nicht geladen werden.');
        setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={placeholderStyle}>…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={errorStyle}>{error}</div>
      </div>
    );
  }

  if (!quote) {
    return (
      <div style={containerStyle}>
        <div style={placeholderStyle}>Noch keine Zitate in der Datenbank.</div>
      </div>
    );
  }

  const attribution = getDisplayAttribution(quote);

  return (
    <div style={containerStyle}>
      <div style={textStyle}>„{quote.text}"</div>
      {attribution ? (
        <div style={authorStyle}>— {attribution}</div>
      ) : null}
    </div>
  );
}

/** Angezeigter Urheber: gesetzter Autor; leerer String = keine Zeile; NULL = Legacy → Einreicher. */
function getDisplayAttribution(quote) {
  const a = quote.author;
  if (a !== null && a !== undefined) {
    const t = String(a).trim();
    if (t !== '') return t;
    return null;
  }
  return quote.username ? String(quote.username) : null;
}

const containerStyle = {
  textAlign: 'center',
  padding: 'clamp(1rem, 4vw, 2rem) clamp(0.75rem, 4vw, 3rem)',
  paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
  paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
  maxWidth: 700,
  margin: '0 auto',
  boxSizing: 'border-box',
  width: '100%',
};

const textStyle = {
  color: 'var(--home-quote-text)',
  fontSize: 'clamp(1rem, 2.5vw, 1.5rem)',
  fontStyle: 'italic',
  lineHeight: 1.6,
  letterSpacing: '0.05em',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

const authorStyle = {
  marginTop: '0.75rem',
  color: 'var(--home-quote-author)',
  fontSize: 'clamp(0.75rem, 2.5vw, 0.85rem)',
  letterSpacing: '0.15em',
  overflowWrap: 'anywhere',
};

const placeholderStyle = {
  color: 'var(--home-quote-muted)',
  fontSize: 'clamp(1rem, 2.5vw, 1.35rem)',
  fontStyle: 'italic',
};

const errorStyle = {
  ...placeholderStyle,
  color: 'var(--home-quote-error)',
};

export default QuoteDisplay;
