// Measures the handler-side CPU of a request rejected for missing App Check (logger.warn included).
const { createApiHandler } = require('/tmp/claude-1000/-home-natkins-projects-solara/7d31f2a2-d18e-4b42-ba5a-aaf38d585d5e/scratchpad/lane-FIX3A/functions/lib/shared/http')
const h = createApiHandler({ name: 'forecast', method: 'GET', allowedOrigin: () => 'https://solara-uv.web.app',
  appCheck: () => ({}), appCheckMode: 'standard', perAddressPerMinute: 1e9, fallbackMessage: 'x', handler: async () => ({ body: {} }) })
const res = { set() {}, status() { return res }, json() {}, send() {} }
;(async () => {
  const N = 50000; const t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) await h({ method: 'GET', headers: { 'x-forwarded-for': '2001:db8::' + (i % 65535).toString(16) }, socket: {} }, res)
  const us = Number(process.hrtime.bigint() - t) / 1000 / N
  console.error('handler CPU per rejected request: ' + us.toFixed(1) + ' us -> ~' + Math.round(1e6 / us) + ' rejections/s per vCPU (handler only, excludes HTTP parsing)')
})()
