import 'ketcher-react/dist/index.css';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';

const structServiceProvider = new StandaloneStructServiceProvider();

export default function MoleculeBuilderCanvas({ onReady }) {
  // Ketcher feuert `onInit` manchmal zweimal — der erste Aufruf kommt mit einem
  // halb-initialisierten Editor (Indigo-Service noch nicht verdrahtet), der
  // zweite ist der voll funktionsfaehige. Vorher haben wir per Ref nur den
  // ersten durchgelassen — Folge: `ketcher.generateImage` hing endlos, weil
  // der Service-Worker fehlte. Jetzt latest-wins (wie schon bei `window.ketcher`).
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
          onReady?.(ketcher);
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
