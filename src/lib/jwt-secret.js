/**
 * Ein Secret für alle JWT-Operationen. In Production muss JWT_SECRET gesetzt sein
 * (Vercel → Environment Variables).
 */
export function getJwtSecretBytes() {
  const s = import.meta.env.JWT_SECRET;
  if (s && String(s).trim().length > 0) {
    return new TextEncoder().encode(String(s));
  }
  if (import.meta.env.DEV) {
    return new TextEncoder().encode('dev-only-jwt-secret-min-32-chars-long!!');
  }
  throw new Error(
    'JWT_SECRET fehlt: In Vercel unter Settings → Environment Variables setzen und neu deployen.'
  );
}
