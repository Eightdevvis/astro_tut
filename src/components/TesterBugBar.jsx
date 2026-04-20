import { useEffect, useMemo, useState } from 'preact/hooks';

const floatingButtonStyle = {
  position: 'fixed',
  right: 'max(12px, calc(env(safe-area-inset-right, 0px) + 10px))',
  bottom: 'max(12px, calc(env(safe-area-inset-bottom, 0px) + 10px))',
  zIndex: 1200,
  width: 56,
  height: 56,
  borderRadius: '999px',
  border: '1px solid rgba(255,255,255,0.5)',
  background: 'rgba(0, 0, 0, 0.42)',
  backdropFilter: 'blur(6px)',
  color: '#fff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1250,
  background: 'rgba(0,0,0,0.46)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
};

const modalStyle = {
  width: 'min(420px, 100%)',
  background: 'rgba(16,16,20,0.95)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 12,
  boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
  color: '#fff',
  padding: 14,
};

const modalActionStyle = {
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: 8,
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.86rem',
};

export default function TesterBugBar() {
  const [user, setUser] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');

  useEffect(() => {
    fetch('/api/user', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => {});
  }, []);

  const showBar = useMemo(() => Boolean(user?.isTester && user?.testerUiEnabled), [user]);
  if (!showBar) return null;

  async function openCaptureDialog() {
    setCapturing(true);
    setMessage('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const detailsOpenState = Array.from(document.querySelectorAll('details')).map((el) =>
        el.hasAttribute('open')
      );
      const canvas = await html2canvas(document.body, {
        scale: Math.min(2, window.devicePixelRatio || 1),
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        useCORS: true,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          const clonedDetails = Array.from(clonedDoc.querySelectorAll('details'));
          clonedDetails.forEach((el, idx) => {
            const isOpen = detailsOpenState[idx] === true;
            if (isOpen) el.setAttribute('open', '');
            else {
              el.removeAttribute('open');
              const panel = el.querySelector('.nav2-drawer-panel');
              if (panel) panel.style.display = 'none';
            }
          });
        },
      });
      setScreenshotDataUrl(canvas.toDataURL('image/png', 0.95));
      setShowModal(true);
    } catch (err) {
      setMessage(err?.message || 'Screenshot fehlgeschlagen');
    } finally {
      setCapturing(false);
    }
  }

  function closeModal() {
    if (sending) return;
    setShowModal(false);
    setComment('');
    setScreenshotDataUrl('');
  }

  async function sendReport() {
    if (!screenshotDataUrl) {
      setMessage('Kein Screenshot vorhanden');
      return;
    }
    setSending(true);
    setMessage('');
    try {
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
      closeModal();
      setComment('');
      setMessage('Screenshot wurde gesendet.');
    } catch (err) {
      setMessage(err?.message || 'Screenshot fehlgeschlagen');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {message ? (
        <div
          style={{
            position: 'fixed',
            right: 'max(12px, calc(env(safe-area-inset-right, 0px) + 10px))',
            bottom: 'max(74px, calc(env(safe-area-inset-bottom, 0px) + 70px))',
            zIndex: 1201,
            maxWidth: 260,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'rgba(0,0,0,0.72)',
            color: '#fff',
            padding: '6px 10px',
            fontSize: '0.8rem',
          }}
        >
          {message}
        </div>
      ) : null}
      <button
        type="button"
        style={floatingButtonStyle}
        disabled={capturing || sending}
        onClick={() => void openCaptureDialog()}
        aria-label="Bug-Screenshot aufnehmen"
        title="Bug-Screenshot aufnehmen"
      >
        {capturing ? (
          <span style={{ fontSize: '0.78rem' }}>…</span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8.5 6.5 9.8 5h4.4l1.3 1.5H18A3 3 0 0 1 21 9.5v7A3.5 3.5 0 0 1 17.5 20h-11A3.5 3.5 0 0 1 3 16.5v-7A3 3 0 0 1 6 6.5h2.5zm3.5 2A4.5 4.5 0 1 0 12 17a4.5 4.5 0 0 0 0-9zm0 2A2.5 2.5 0 1 1 12 15a2.5 2.5 0 0 1 0-5z"
            />
          </svg>
        )}
      </button>
      {showModal ? (
        <div style={overlayStyle} onClick={closeModal}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8 }}>
              Bug-Screenshot senden
            </div>
            <textarea
              value={comment}
              onInput={(e) => setComment(e.currentTarget.value)}
              placeholder="Optionale Nachricht"
              rows={4}
              style={{
                width: '100%',
                border: '1px solid rgba(255,255,255,0.26)',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                padding: '8px 10px',
                boxSizing: 'border-box',
                resize: 'vertical',
                marginBottom: 10,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={modalActionStyle} onClick={closeModal} disabled={sending}>
                Abbrechen
              </button>
              <button
                type="button"
                style={{ ...modalActionStyle, background: 'rgba(72, 176, 255, 0.22)' }}
                onClick={() => void sendReport()}
                disabled={sending}
              >
                {sending ? 'Speichere…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
