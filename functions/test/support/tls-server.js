// A local https server for tests that need a real TLS connection (hostile calendar
// sites, REVIEW5 H1). The certificate is self-signed and made for each run with openssl,
// so no private key is ever checked in; `localTransport` trusts it as its only extra CA,
// so the certificate is still verified against the host name.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const { createServer } = require('node:https')
const os = require('node:os')
const path = require('node:path')

const { createHttpsTransport } = require('../../lib/events/safe-fetch')

let credentials
function selfSigned() {
  if (credentials) return credentials
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solara-tls-'))
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    )
    credentials = {
      key: fs.readFileSync(path.join(dir, 'key.pem')),
      cert: fs.readFileSync(path.join(dir, 'cert.pem')),
    }
    return credentials
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Starts an https server on 127.0.0.1 answering each path with `routes[path](req, res)`.
 * Resolves to { port, close }.
 */
async function startTlsServer(routes) {
  const server = createServer(selfSigned(), (req, res) => {
    const route = routes[new URL(req.url, 'https://localhost').pathname]
    if (route) route(req, res)
    else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/**
 * The real https transport, sent to the local server instead of the checked public
 * address (the address checks have their own tests), trusting its self-signed certificate.
 */
function localTransport(port) {
  const transport = createHttpsTransport({ ca: selfSigned().cert })
  return request =>
    transport({
      ...request,
      url: new URL(request.url.pathname + request.url.search, `https://localhost:${port}`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    })
}

module.exports = { localTransport, startTlsServer }
