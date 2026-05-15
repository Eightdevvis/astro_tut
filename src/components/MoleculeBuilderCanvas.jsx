import 'ketcher-react/dist/index.css';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import { dbg } from '../lib/mikrobio-debug.js';

dbg('canvas-module-eval');

const structServiceProvider = new StandaloneStructServiceProvider();
dbg('struct-service-constructed', {
  ctor: structServiceProvider?.constructor?.name || null,
});

export default function MoleculeBuilderCanvas({ onReady }) {
  dbg('canvas-render');
  let initCount = 0;
  return (
    <div className="mb-ketcher-host">
      <Editor
        staticResourcesUrl=""
        structServiceProvider={structServiceProvider}
        disableMacromoleculesEditor
        errorHandler={(message) => {
          dbg('ketcher-errorHandler', { message: String(message) });
          // eslint-disable-next-line no-console
          console.error('[Ketcher]', message);
        }}
        onInit={(ketcher) => {
          initCount += 1;
          const probe = {
            n: initCount,
            type: typeof ketcher,
            keys: ketcher ? Object.keys(ketcher).slice(0, 12) : null,
            hasGenerateImage: typeof ketcher?.generateImage === 'function',
            hasSetMolecule: typeof ketcher?.setMolecule === 'function',
            hasGetMolfile: typeof ketcher?.getMolfile === 'function',
          };
          dbg('ketcher-onInit', probe);
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
