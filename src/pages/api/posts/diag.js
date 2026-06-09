// TEMP-DIAGNOSE (entfernen, sobald der Prod-500 von /api/posts/add geklaert ist).
//
// Diese Route hat KEINE schweren top-level Imports, laedt also selbst sauber.
// Beim GET importiert sie add.js und dann jede Abhaengigkeit einzeln DYNAMISCH
// in einem try/catch. So zeigt die JSON-Antwort genau, welcher Import beim
// Laden auf der Vercel-Runtime wirft (und mit welcher Meldung) — statt eines
// leeren Plattform-500.
export async function GET() {
  const targets = [
    './add.js',
    'bcryptjs',
    'jose',
    'isomorphic-dompurify',
    '../../../lib/sanitize-html.js',
    '../../../lib/db.js',
    '../../../lib/permissions.js',
    '../../../lib/jwt-secret.js',
    '../../../lib/blog-privacy.js',
    '../../../lib/user-privacy-defaults.js',
    '../../../lib/backup-webhook.js',
  ];
  const results = {};
  for (const t of targets) {
    try {
      await import(t);
      results[t] = 'ok';
    } catch (e) {
      results[t] = 'ERR: ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : String(e));
    }
  }
  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
