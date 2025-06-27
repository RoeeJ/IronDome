import { serve } from 'bun';
import index from './index.html';
import tubeEditor from './tools/tube-editor/index.html';
import modelViewer from '../model-viewer.html';

const server = serve({
  routes: {
    // Serve tube editor
    '/tube-editor': tubeEditor,

    // Serve model viewer
    '/model-viewer': modelViewer,

    // Serve assets
    '/assets/*': async req => {
      const url = new URL(req.url);
      const filePath = new URL('..' + url.pathname, import.meta.url);
      try {
        const file = Bun.file(filePath);
        return new Response(file, {
          headers: {
            'Content-Type': getContentType(url.pathname),
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (error) {
        return new Response('Not found', { status: 404 });
      }
    },

    // Serve index.html for all unmatched routes.
    '/*': index,

    '/api/hello': {
      async GET(req) {
        return Response.json({
          message: 'Hello, world!',
          method: 'GET',
        });
      },
      async PUT(req) {
        return Response.json({
          message: 'Hello, world!',
          method: 'PUT',
        });
      },
    },

    '/api/hello/:name': async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== 'production' && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

function getContentType(pathname: string): string {
  if (pathname.endsWith('.obj')) return 'text/plain';
  if (pathname.endsWith('.mtl')) return 'text/plain';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.gltf')) return 'model/gltf+json';
  if (pathname.endsWith('.glb')) return 'model/gltf-binary';
  if (pathname.endsWith('.bin')) return 'application/octet-stream';
  return 'application/octet-stream';
}
