import test from 'node:test'
import assert from 'node:assert/strict'
import https from 'node:https'
import os from 'node:os'
import { EventEmitter } from 'node:events'

async function runWithCms(fetch) {
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  const output = []
  globalThis.fetch = fetch
  console.log = value => output.push(JSON.parse(value))
  try {
    await import(`./editorial-context.mjs?test=${Math.random()}`)
    return output[0]
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
  }
}

test('reads published CMS directly and exposes only existing routes/document fields', async () => {
  const requests = []
  const context = await runWithCms(async url => {
    requests.push(new URL(url))
    const name = new URL(url).pathname.split('/').at(-1)
    const data = {
      products: [{ sku: '2021001', slug: 'never-a-product-route', material: 'ПВХ', outerDiameter: 16 }],
      articles: [{ slug: 'real-cms-article', title: 'Article', sections: [], publishedOn: '2026-09-23' }],
      documents: [{ title: 'Certificate', subtitle: 'Confirmed PDF subtitle', file: { url: '/uploads/certificate.pdf' } }],
    }[name]
    return { ok: true, json: async () => ({ data, meta: { pagination: { pageCount: 1 } } }) }
  })
  assert.equal(requests.length, 3)
  assert(requests.every(url => url.origin === 'https://cms.rusplast-zavod.ru'))
  assert(requests.every(url => url.searchParams.get('status') === 'published'))
  assert.equal(context.source, 'strapi')
  for (const route of ['/#contacts', '/#certificates', '/#about', '/#delivery', '/#request', '/catalog/aksessuary', '/blog/real-cms-article']) {
    assert(context.internalPaths.includes(route), route)
  }
  assert(!context.internalPaths.some(route => ['/contacts', '/documents'].includes(route) || route.startsWith('/product/')))
  assert.deepEqual(context.documentRecords, [{ title: 'Certificate', subtitle: 'Confirmed PDF subtitle', file: 'https://cms.rusplast-zavod.ru/uploads/certificate.pdf' }])
})

test('CMS outage fails without falling back to local articles/catalog', async () => {
  const calls = {}
  await assert.rejects(runWithCms(async url => {
    const name = new URL(url).pathname.split('/').at(-1)
    calls[name] = (calls[name] || 0) + 1
    return { ok: false, status: 503 }
  }), /CMS .* unavailable: 503/)
  assert.deepEqual(calls, { products: 3, articles: 3, documents: 3 })
})

test('recovers transient connection and server failures using fresh CMS data', async () => {
  const calls = {}
  const result = await runWithCms(async url => {
    const name = new URL(url).pathname.split('/').at(-1)
    calls[name] = (calls[name] || 0) + 1
    if (calls[name] === 1) throw new TypeError('fetch failed')
    if (calls[name] === 2) return { ok: false, status: 503 }
    const data = { products: [{ sku: 'live-sku' }], articles: [{ slug: 'live-article', title: 'Fresh CMS article', sections: [] }], documents: [] }[name]
    return { ok: true, json: async () => ({ data }) }
  })
  assert.equal(result.products[0].sku, 'live-sku')
  assert.equal(result.articles[0].slug, 'live-article')
  assert.deepEqual(calls, { products: 3, articles: 3, documents: 3 })
})

test('permanent access failures and malformed CMS responses are not retried', async () => {
  for (const response of [{ ok: false, status: 403 }, { ok: true, json: async () => ({ data: null }) }]) {
    let calls = 0
    await assert.rejects(runWithCms(async () => { calls++; return response }), /CMS .* (unavailable: 403|response)/)
    assert.equal(calls, 3, 'One attempt per collection')
  }
})

test('bound CMS requests retry a reset response stream without changing transport', async t => {
  const previous = process.env.RUSPLAST_NETWORK_INTERFACE
  process.env.RUSPLAST_NETWORK_INTERFACE = 'test-interface'
  t.after(() => {
    if (previous === undefined) delete process.env.RUSPLAST_NETWORK_INTERFACE
    else process.env.RUSPLAST_NETWORK_INTERFACE = previous
  })
  t.mock.method(os, 'networkInterfaces', () => ({
    'test-interface': [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
  }))
  const calls = {}
  t.mock.method(https, 'get', (url, options, callback) => {
    assert.equal(options.localAddress, '192.0.2.10')
    assert(options.signal instanceof AbortSignal)
    const name = new URL(url).pathname.split('/').at(-1)
    calls[name] = (calls[name] || 0) + 1
    const request = new EventEmitter()
    queueMicrotask(() => {
      const response = new EventEmitter()
      response.statusCode = 200
      callback(response)
      if (calls[name] === 1) {
        response.emit('error', Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }))
        return
      }
      const data = { products: [{ sku: 'live-sku' }], articles: [{ slug: 'live-article', sections: [] }], documents: [] }[name]
      response.emit('data', Buffer.from(JSON.stringify({ data })))
      response.emit('end')
    })
    return request
  })
  const result = await runWithCms(() => { throw new Error('Unbound fetch must not run') })
  assert.equal(result.products[0].sku, 'live-sku')
  assert.deepEqual(calls, { products: 2, articles: 2, documents: 2 })
})
