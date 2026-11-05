/**
 * Vercel Routing Middleware: runs before every request (the page, JS/CSS and
 * data/snapshot.json) and requires the username/password from the project's
 * BASIC_AUTH_USER / BASIC_AUTH_PASSWORD environment variables.
 */
import { next } from '@vercel/functions';
import { AUTH_CHALLENGE, isAuthorized } from './basic-auth';

export default function middleware(request: Request) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  // Fail closed: if the credentials aren't configured, serve nothing.
  if (!user || !password) {
    return new Response('Dashboard login is not configured.', { status: 503 });
  }
  if (isAuthorized(request.headers.get('authorization'), user, password)) return next();
  return new Response('Authentication required.', { status: 401, headers: AUTH_CHALLENGE });
}
