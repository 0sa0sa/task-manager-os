import { serveStatic } from '@hono/node-server/serve-static';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createApp } from './app.js';
import { SonioxSession } from './soniox.js';
import { Store } from './store.js';

declare const Bun: any;

const port = Number(process.env.PORT ?? 8798);
const path = process.env.TASK_MANAGER_OS_DATA_PATH ?? join(homedir(), '.task-manager-os', 'state.json');
const app = createApp(new Store(path));
app.use('/*', serveStatic({ root: './dist' }));
app.get('/*', serveStatic({ path: './dist/index.html' }));
Bun.serve({
  port,
  fetch(request: Request, server: any) {
    const url = new URL(request.url);
    if (url.pathname === '/api/soniox' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const upgraded = server.upgrade(request, { data: { session: new SonioxSession() } });
      return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 426 });
    }
    return app.fetch(request);
  },
  websocket: {
    open(ws: any) { ws.data.session.attach(ws); },
    message(ws: any, data: string | ArrayBuffer | Uint8Array) { ws.data.session.message(data); },
    close(ws: any) { ws.data.session.close(); },
  },
});
console.log(`Task Manager OS: http://localhost:${port}`);
