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

  return (
    <div style={containerStyle}>
      <div style={textStyle}>„{quote.text}"</div>
      <div style={authorStyle}>— {quote.username.toUpperCase()}</div>
    </div>
  );
}

const containerStyle = {
  textAlign: 'center',
  padding: '2rem 3rem',
  maxWidth: 700,
  margin: '0 auto',
};

const textStyle = {
  color: 'rgba(255,255,255,0.85)',
  fontSize: 'clamp(1rem, 2.5vw, 1.5rem)',
  fontStyle: 'italic',
  lineHeight: 1.6,
  letterSpacing: '0.05em',
};

const authorStyle = {
  marginTop: '0.75rem',
  color: 'rgba(173, 216, 230, 0.7)',
  fontSize: '0.85rem',
  letterSpacing: '0.15em',
};

const placeholderStyle = {
  color: 'rgba(255,255,255,0.45)',
  fontSize: 'clamp(1rem, 2.5vw, 1.35rem)',
  fontStyle: 'italic',
};

const errorStyle = {
  ...placeholderStyle,
  color: 'rgba(255, 160, 140, 0.9)',
};

export default QuoteDisplay;
