import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function createStaticAssetsBinding(rootDirectory) {
  if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) {
    throw new TypeError('Static assets directory must be absolute.');
  }
  const root = path.resolve(rootDirectory);
  return Object.freeze({
    async fetch(request) {
      if (!(request instanceof Request) || !['GET', 'HEAD'].includes(request.method)) {
        return notFound();
      }
      const pathname = decodePathname(request.url);
      if (pathname === null) return notFound();
      let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      let filename = safeResolve(root, relative);
      let fileStatus = filename ? await fileStat(filename) : null;
      if (!fileStatus && !path.extname(relative)) {
        relative = 'index.html';
        filename = safeResolve(root, relative);
        fileStatus = filename ? await fileStat(filename) : null;
      }
      if (!filename || !fileStatus?.isFile()) return notFound();
      const headers = {
        'cache-control': relative === 'index.html'
          ? 'no-cache'
          : 'public, max-age=3600',
        'content-length': String(fileStatus.size),
        'content-type': CONTENT_TYPES.get(path.extname(filename).toLowerCase())
          ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      };
      return new Response(
        request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(filename)),
        { status: 200, headers },
      );
    },
  });
}

function decodePathname(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith('/')
    || pathname.includes('\\')
    || pathname.includes('\u0000')
    || pathname.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  return pathname;
}

function safeResolve(root, relative) {
  const filename = path.resolve(root, relative);
  return filename === root || filename.startsWith(`${root}${path.sep}`) ? filename : null;
}

async function fileStat(filename) {
  try {
    return await stat(filename);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
