import { useState, useEffect } from 'preact/hooks';
import {
  MIKROBIO_DBG_EVENTS,
  subscribeDbg,
  clearDbg,
  isDebugEnabled,
  dbg,
} from '../lib/mikrobio-debug.js';

// Fixiertes Overlay unten am Bildschirm. Zeigt alle dbg()-Events mit
// relativer Zeit. Schaltet sich per `?nodbg=1` oder
// `localStorage.setItem('mikrobio:debug','off')` aus.
export default function MikrobioDebugPanel() {
  const [, force] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(isDebugEnabled());
    return subscribeDbg(() => force((v) => v + 1));
  }, []);

  // Globale Fehler-Listener: alles aufschnappen, was während Mikrobio-Game
  // schief geht (Worker-Fehler, WASM-Loads, Ketcher-Rejections etc.).
  useEffect(() => {
    if (!enabled) return undefined;
    const onErr = (e) =>
      dbg('window.error', {
        msg: e.message,
        file: e.filename,
        line: e.lineno,
        col: e.colno,
      });
    const onRej = (e) =>
      dbg('unhandledrejection', {
        reason: String(e.reason?.message || e.reason || ''),
      });
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [enabled]);

  if (!enabled) return null;

  const events = MIKROBIO_DBG_EVENTS;
  const start = events[0]?.t ?? 0;
  const last = events[events.length - 1];

  return (
    <div className={`mdp-root ${collapsed ? 'mdp-collapsed' : ''}`}>
      <div className="mdp-bar">
        <strong>MIKROBIO DEBUG</strong>
        <span className="mdp-count">{events.length} events</span>
        {last && (
          <span className="mdp-last">
            +{((last.t - start) / 1000).toFixed(2)}s · {last.label}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? 'expand' : 'collapse'}
        </button>
        <button type="button" onClick={() => clearDbg()}>
          clear
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              const text = events
                .map(
                  (e) =>
                    `+${((e.t - start) / 1000).toFixed(2)}s ${e.label}` +
                    (e.data !== null
                      ? ` ${JSON.stringify(e.data)}`
                      : ''),
                )
                .join('\n');
              navigator.clipboard?.writeText(text);
              dbg('copied-to-clipboard', { bytes: text.length });
            } catch (err) {
              dbg('copy-failed', { msg: String(err) });
            }
          }}
        >
          copy
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage?.setItem('mikrobio:debug', 'off');
            } catch {
              /* ignore */
            }
            setEnabled(false);
          }}
        >
          hide
        </button>
      </div>
      {!collapsed && (
        <div className="mdp-log">
          {events.map((e, i) => (
            <div className="mdp-row" key={i}>
              <span className="mdp-t">
                +{((e.t - start) / 1000).toFixed(2)}s
              </span>
              <span className="mdp-label">{e.label}</span>
              {e.data !== null && (
                <span className="mdp-data">{JSON.stringify(e.data)}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <style>{`
        .mdp-root {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 99999;
          background: #000c;
          color: #b2ffb2;
          font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          border-top: 2px solid #2ecc71;
          backdrop-filter: blur(6px);
          max-height: 45vh;
          display: flex;
          flex-direction: column;
        }
        .mdp-collapsed { max-height: none; }
        .mdp-bar {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 6px 10px;
          flex-wrap: wrap;
          background: #001a08;
          border-bottom: 1px solid #2ecc71;
        }
        .mdp-bar strong { color: #2ecc71; letter-spacing: 0.1em; }
        .mdp-count { opacity: 0.75; }
        .mdp-last {
          opacity: 0.85;
          font-variant-numeric: tabular-nums;
          margin-left: auto;
          max-width: 60%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mdp-bar button {
          font: inherit;
          background: #062;
          color: #fff;
          border: 1px solid #2ecc71;
          padding: 2px 8px;
          border-radius: 4px;
          cursor: pointer;
        }
        .mdp-bar button:hover { background: #083; }
        .mdp-log {
          overflow: auto;
          padding: 4px 10px 8px;
          flex: 1;
        }
        .mdp-row {
          display: grid;
          grid-template-columns: 70px 220px 1fr;
          gap: 8px;
          padding: 1px 0;
          border-bottom: 1px dashed #064;
          word-break: break-all;
        }
        .mdp-t { color: #6cf; font-variant-numeric: tabular-nums; }
        .mdp-label { color: #fff; }
        .mdp-data { color: #ffd; opacity: 0.9; }
      `}</style>
    </div>
  );
}
