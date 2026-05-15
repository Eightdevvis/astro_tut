import 'ketcher-react/dist/index.css';
import { useRef } from 'preact/hooks';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';

const structServiceProvider = new StandaloneStructServiceProvider();

export default function MoleculeBuilderCanvas() {
  // Ketcher's outer Editor-Wrapper feuert `onInit` zweimal, weil sein innerer
  // `MicromoleculesEditor` einen Init-Cycle fuer React-StrictMode hat, den
  // Preact-Suspense ungewollt mit triggert. Nur den ersten Init durchlassen —
  // `window.ketcher` aktualisieren wir aber immer (latest wins).
  const initedRef = useRef(false);

  return (
    <div className="mb-ketcher-host">
      <Editor
        staticResourcesUrl=""
        structServiceProvider={structServiceProvider}
        disableMacromoleculesEditor
        errorHandler={(message) => {
          // eslint-disable-next-line no-console
          console.error('[Ketcher]', message);
        }}
        onInit={(ketcher) => {
          if (typeof window !== 'undefined') {
            window.ketcher = ketcher;
          }
          if (initedRef.current) return;
          initedRef.current = true;
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
