/**
 * Static file serving for the local test servers (tests/harness/serve.mjs and
 * tests/e2e/signed-in/server.mjs), with the trailing-slash routing Firebase
 * Hosting uses: `/a` and `/a/` both serve `a/index.html`.
 *
 * A request can only ever reach a regular file inside the served root:
 * - the path is decoded one segment at a time, and a segment that decodes to
 *   `.` or `..`, or contains a slash, a backslash or a NUL byte, refuses the
 *   whole request, so traversal is never followed, encoded or not;
 * - the resolved path must sit inside the root before the file system is touched;
 * - the real path (after symlinks) must sit inside the root as well.
 * Anything else is a 404, never an error that could stop the server.
 *
 * Node runs this file directly (type stripping), so it uses erasable syntax only.
 */
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** The decoded path segments of a request target, or null if it is not a plain, safe path. */
function pathSegments(url: string): string[] | null {
  const path = url.split(/[?#]/, 1)[0] ?? ''
  // Origin-form only: `/a/b`. Absolute-form (`http://host/a`) and `*` are refused.
  if (!path.startsWith('/')) return null
  const segments: string[] = []
  for (const raw of path.split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) return null
    if (segment) segments.push(segment)
  }
  return segments
}

/** The real path of `candidate` if it is a regular file inside `root`, else null. */
function fileInside(root: string, candidate: string): string | null {
  const file = resolve(candidate)
  if (!file.startsWith(root + sep)) return null
  let real: string
  try {
    real = realpathSync(file)
  } catch {
    return null
  }
  if (!real.startsWith(root + sep)) return null
  try {
    return statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

/**
 * The file under `root` that a request target maps to, or null for a 404.
 * `root` must be an absolute real path (see createStaticHandler).
 */
export function resolveStaticFile(root: string, url: string): string | null {
  const segments = pathSegments(url)
  if (!segments) return null
  const target = join(root, ...segments)
  return fileInside(root, target) ?? fileInside(root, join(target, 'index.html'))
}

/** A request handler that serves `root` like Firebase Hosting serves the export. */
export function createStaticHandler(
  root: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  const realRoot = realpathSync(resolve(root))
  const notFound = join(realRoot, '404.html')
  return (req, res) => {
    const file = resolveStaticFile(realRoot, req.url ?? '/')
    if (!file) {
      // Like Firebase Hosting: unknown paths get the exported 404 page.
      if (existsSync(notFound)) {
        res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' })
        createReadStream(notFound).pipe(res)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
      }
      return
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    createReadStream(file).pipe(res)
  }
}
