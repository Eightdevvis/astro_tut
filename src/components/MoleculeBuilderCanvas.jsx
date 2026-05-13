import 'ketcher-react/dist/index.css';
import { useEffect, useRef } from 'preact/hooks';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';

const structServiceProvider = new StandaloneStructServiceProvider();

export default function MoleculeBuilderCanvas({ onDebug }) {
  // onDebug wechselt bei jedem Parent-Render die Identitaet. Wir parken sie in
  // einer Ref und lassen den Mount/Unmount-Effekt mit [] laufen — sonst feuert
  // er bei jedem Render erneut und unmounted Ketcher in einer Endlosschleife.
  const onDebugRef = useRef(onDebug);
  onDebugRef.current = onDebug;
  // Ketcher's outer Editor-Wrapper feuert `onInit` zweimal, weil sein innerer
  // `MicromoleculesEditor` einen Init-Cycle fuer React-StrictMode hat, den
  // Preact-Suspense ungewollt mit triggert. Wir lassen nur den ersten Init
  // durch — `window.ketcher` aktualisieren wir aber immer (latest wins).
  const initedRef = useRef(false);

  useEffect(() => {
    onDebugRef.current?.({ phase: 'canvas:mount', t: Date.now() });
    return () => onDebugRef.current?.({ phase: 'canvas:unmount', t: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-ketcher-host">
      <Editor
        staticResourcesUrl=""
        structServiceProvider={structServiceProvider}
        disableMacromoleculesEditor
        errorHandler={(message) => {
          // eslint-disable-next-line no-console
          console.error('[Ketcher]', message);
          onDebugRef.current?.({ phase: 'ketcher:error', t: Date.now(), message: String(message) });
        }}
        onInit={(ketcher) => {
          if (typeof window !== 'undefined') {
            window.ketcher = ketcher;
          }
          if (initedRef.current) {
            onDebugRef.current?.({ phase: 'ketcher:reinit-skipped', t: Date.now() });
            return;
          }
          initedRef.current = true;
          onDebugRef.current?.({ phase: 'ketcher:ready', t: Date.now() });
        }}
      />
      <style>{`
        .mb-ketcher-host {
          width: 100%;
          height: 78vh;
          min-height: 600px;
          display: flex;
        }
        .mb-ketcher-host > * {
          flex: 1;
          min-width: 0;
          min-height: 0;
        }
      `}</style>
    </div>
  );
}
