// A local stand-in for Open-Meteo's commercial API, for the signed-in e2e suite.
//
// run.mjs starts it and points the Functions emulator's forecast proxy at it
// (OPEN_METEO_API_BASE, honored only inside the emulator; see
// functions/src/forecast/config.ts). It answers /v1/forecast with a fixed forecast when
// the API key matches, and counts the calls so a test can see the proxy's cache work.
import { createServer } from 'node:http'

/** The forecast it serves: two hours of a UTC day, enough for the shared parser. */
export const FAKE_FORECAST = Object.freeze({
  timezone: 'UTC',
  current: { time: '2026-06-15T17:00', uv_index: 7.2, temperature_2m: 26.4, weathercode: 1 },
  hourly: {
    time: ['2026-06-15T17:00', '2026-06-15T18:00'],
    uv_index: [7.2, 6.1],
    temperature_2m: [26.4, 26.9],
    weathercode: [1, 2],
    cloudcover: [10, 25],
  },
})

export function startFakeOpenMeteo({ host = '127.0.0.1', port, apiKey }) {
  const calls = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`)
    if (url.pathname === '/__test/calls') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(calls))
      return
    }
    if (url.pathname !== '/v1/forecast') {
      res.writeHead(404).end()
      return
    }
    calls.push(Object.fromEntries(url.searchParams))
    if (url.searchParams.get('apikey') !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: true, reason: 'Invalid API key' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(FAKE_FORECAST))
  })
  return new Promise(resolveStarted => server.listen(port, host, () => resolveStarted(server)))
}
