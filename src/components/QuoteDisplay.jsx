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

  useEffect(() => {
    fetch('/api/quotes/random')
      .then(res => res.json())
      .then(data => {
        setQuote(data.quote);
        setLoading(false);
      });
  }, []);

  if (loading) return null;
  if (!quote) return null;  // keine Zitate in der DB → nichts anzeigen

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

export default QuoteDisplay;
