/** Optionen für das Session-Cookie — auf Vercel (HTTPS) muss secure: true sein. */
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
  };
}
