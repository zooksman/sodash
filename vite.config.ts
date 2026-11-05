import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { AUTH_CHALLENGE, isAuthorized } from './basic-auth.js';

/** Same login as production, for `npm run dev` and `npm run preview`. Reads .env. */
function basicAuth(user: string, password: string): Plugin {
  const guard = (req: IncomingMessage, res: ServerResponse, nextFn: () => void) => {
    if (isAuthorized(req.headers.authorization, user, password)) return nextFn();
    res.writeHead(401, AUTH_CHALLENGE).end('Authentication required.');
  };
  return {
    name: 'basic-auth',
    configureServer: (server) => void server.middlewares.use(guard),
    configurePreviewServer: (server) => void server.middlewares.use(guard),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BASIC_AUTH_');
  const enabled = Boolean(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD);
  return {
    plugins: [react(), ...(enabled ? [basicAuth(env.BASIC_AUTH_USER, env.BASIC_AUTH_PASSWORD)] : [])],
  };
});
