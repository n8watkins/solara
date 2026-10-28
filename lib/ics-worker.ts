// The Web Worker that parses an imported .ics file (lib/events.ts parseIcsOffThread), so
// the page stays responsive however long a file takes to read. It runs the same parser
// a Function can (packages/core/src/ics-parse.ts) and posts back the result or the error.
import { IcsImportError, parseIcs, type IcsParseOptions } from '@solara/core/event-import'
import type { IcsWorkerReply } from './events'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ text: string; options: IcsParseOptions }>) => void) | null
  postMessage: (reply: IcsWorkerReply) => void
}

scope.onmessage = event => {
  const { text, options } = event.data
  try {
    scope.postMessage({ ok: true, result: parseIcs(text, options) })
  } catch (error) {
    scope.postMessage({
      ok: false,
      code: error instanceof IcsImportError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
