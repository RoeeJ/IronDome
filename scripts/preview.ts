import { stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const { basePath } = (await Bun.file(path.join(root, 'build-info.json')).json()) as {
  basePath: string;
};

const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  async fetch(request) {
    const url = new URL(request.url);
    if (basePath !== '/' && url.pathname === basePath.slice(0, -1)) {
      return Response.redirect(new URL(basePath + url.search, url), 301);
    }
    if (!url.pathname.startsWith(basePath)) return new Response('Not found', { status: 404 });

    let filePath: string;
    try {
      filePath = path.resolve(root, decodeURIComponent(url.pathname.slice(basePath.length)));
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return new Response('Not found', { status: 404 });
    }

    try {
      if ((await stat(filePath)).isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          url.pathname += '/';
          return Response.redirect(url, 301);
        }
        filePath = path.join(filePath, 'index.html');
      }
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    } catch {
      // Match static hosting: missing files return 404, with no SPA fallback.
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`Preview: http://localhost:${server.port}${basePath}`);
