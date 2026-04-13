import { useEffect, useMemo, useState } from 'preact/hooks';

const shellStyle = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1200,
  padding: '8px max(10px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(10px, env(safe-area-inset-left, 0px))',
  background: 'rgba(0, 0, 0, 0.72)',
  backdropFilter: 'blur(5px)',
  borderTop: '1px solid rgba(255,255,255,0.22)',
  color: '#fff',
};

const innerStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
};

const actionBtn = {
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: 8,
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.85rem',
};

export default function TesterBugBar() {
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/user', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => {});
  }, []);

  const showBar = useMemo(() => Boolean(user?.isTester && user?.testerUiEnabled), [user]);
  if (!showBar) return null;

  async function captureAndSend() {
    setBusy(true);
    setMessage('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(document.documentElement, {
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        backgroundColor: null,
      });
      const screenshotDataUrl = canvas.toDataURL('image/png', 0.95);
      const res = await fetch('/api/tester-bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          screenshotDataUrl,
          pageUrl: window.location.href,
          comment: comment.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      setComment('');
      setMessage('Screenshot wurde gesendet.');
    } catch (err) {
      setMessage(err?.message || 'Screenshot fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside style={shellStyle}>
      <div style={innerStyle}>
        <button type="button" style={actionBtn} disabled={busy} onClick={() => void captureAndSend()}>
          {busy ? 'Sende…' : '📷 Bug-Screenshot senden'}
        </button>
        <input
          type="text"
          value={comment}
          onInput={(e) => setComment(e.currentTarget.value)}
          placeholder="Optionaler Kommentar zum Bug"
          style={{
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            padding: '8px 10px',
            minWidth: 260,
            maxWidth: 'min(560px, 92vw)',
            width: '100%',
          }}
        />
        {message ? <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>{message}</span> : null}
      </div>
    </aside>
  );
}
