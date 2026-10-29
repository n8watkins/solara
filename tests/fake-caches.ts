// An in-memory Cache Storage with what the shared-item stash uses (lib/share-target.ts),
// for its unit tests.
import type { StashCaches } from '../lib/share-target'

/** An in-memory Cache Storage with what the stash uses. */
export function fakeCaches(): StashCaches & { names: () => string[] } {
  const stores = new Map<string, Map<string, Response>>()
  const key = (request: RequestInfo | URL) =>
    typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
  return {
    names: () => [...stores.keys()],
    async has(name) {
      return stores.has(name)
    },
    async open(name) {
      let store = stores.get(name)
      if (!store) stores.set(name, (store = new Map()))
      const entries = store
      return {
        async put(request, response) {
          entries.set(key(request), response.clone())
        },
        async match(request) {
          return entries.get(key(request))?.clone()
        },
        async delete(request) {
          return entries.delete(key(request))
        },
      }
    },
    async delete(name) {
      return stores.delete(name)
    },
  }
}
