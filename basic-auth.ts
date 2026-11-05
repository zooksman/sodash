/**
 * HTTP Basic Auth check shared by the Vercel middleware (production) and the
 * Vite dev/preview server (local). The browser shows its native login dialog.
 */
export const AUTH_CHALLENGE = { 'WWW-Authenticate': 'Basic realm="Social dashboard", charset="UTF-8"' };

/** Constant-time string comparison, so response timing doesn't leak how much matched. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** True if the Authorization header carries the expected username and password. */
export function isAuthorized(header: string | null | undefined, user: string, password: string): boolean {
  const [scheme, encoded] = (header ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  // Evaluate both comparisons so timing doesn't reveal which one failed.
  const userOk = safeEqual(decoded.slice(0, sep), user);
  const passOk = safeEqual(decoded.slice(sep + 1), password);
  return userOk && passOk;
}
