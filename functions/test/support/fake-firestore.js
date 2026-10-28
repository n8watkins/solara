// An in-memory stand-in for the Firestore calls ForecastCache, UpstreamBudget and
// CallerShare make: collection/doc get and set, getAll and runTransaction. Every
// "instance" built on one fake shares its documents, like real Firestore.
function fakeFirestore({ failTransactions = false } = {}) {
  const docs = new Map()
  const stats = { reads: 0, writes: 0, transactions: 0 }
  const snap = path => {
    stats.reads += 1
    const data = docs.get(path)
    return { exists: data !== undefined, data: () => data }
  }
  const write = (path, data) => {
    stats.writes += 1
    docs.set(path, data)
  }
  const ref = (collection, id) => ({
    id,
    path: `${collection}/${id}`,
    get: async () => snap(`${collection}/${id}`),
    set: async data => write(`${collection}/${id}`, data),
  })
  return {
    docs,
    stats,
    collection: name => ({ doc: id => ref(name, id) }),
    getAll: async (...refs) => refs.map(r => snap(r.path)),
    runTransaction: async work => {
      stats.transactions += 1
      if (failTransactions) throw new Error('Firestore unavailable')
      const writes = []
      const result = await work({
        get: async r => snap(r.path),
        getAll: async (...refs) => refs.map(r => snap(r.path)),
        set: (r, data) => writes.push([r.path, data]),
      })
      for (const [path, data] of writes) write(path, data)
      return result
    },
  }
}

module.exports = { fakeFirestore }
