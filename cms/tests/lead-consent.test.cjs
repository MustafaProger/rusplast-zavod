// Run after compiling CMS: node --test cms/tests/lead-consent.test.cjs
// All database/mail calls are in-memory stubs. No leads or messages are sent.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const evidence = require('../dist/src/api/lead/legal/evidence.js')
const consent = require('../src/api/lead/legal/consent.json')

const originalLoad = Module._load
let buildController
try {
  Module._load = function (id, ...rest) {
    if (id === '@strapi/strapi') return { factories: { createCoreController: (_uid, build) => build } }
    return originalLoad.call(this, id, ...rest)
  }
  buildController = require('../dist/src/api/lead/controllers/lead.js').default
} finally {
  Module._load = originalLoad
}
const valid = () => ({ name: 'Тест', phone: '+70000000000', email: 'client@example.test', products: [], consent: true, consentVersion: consent.version })
function fixture() {
  const saved = [], notifications = []
  let lookups = 0
  const controller = buildController({ strapi: {
    documents(uid) {
      if (uid === 'api::product.product') return { async findMany(query) {
        lookups++
        assert.equal(query.status, 'published')
        return [{ sku: 'SKU-1', name: 'Труба', material: 'ПВХ', outerDiameter: 16, coilLength: 50, price: 10 }]
      } }
      return { async create({ data }) { saved.push(data); return { id: 9, documentId: 'stub-lead', ...data } } }
    },
    service() { return { async send(value) { notifications.push(value) } } },
    log: { error() {} },
  } })
  return { saved, notifications, lookups: () => lookups, async submit(data) {
    const ctx = { request: { body: { data } }, query: { populate: '*' }, badRequest: message => ({ error: message }) }
    return { response: await controller.create(ctx), status: ctx.status }
  } }
}

test('missing, checked-as-string, false and stale consent cannot write or send', async () => {
  const f = fixture()
  for (const change of [{ consent: undefined }, { consent: false }, { consent: 'true' }, { consentVersion: '2026-09-05' }, { consentVersion: undefined }]) {
    const result = await f.submit({ ...valid(), ...change })
    assert.ok(result.response.error)
  }
  assert.equal(f.saved.length, 0)
  assert.equal(f.notifications.length, 0)
  assert.equal(f.lookups(), 0)
})

test('server archives exactly the displayed consent; client evidence/status and nested data cannot override it', async () => {
  const f = fixture()
  const before = Date.now()
  const result = await f.submit({
    ...valid(), name: ' Тест ', comment: ' Запрос ',
    status: 'Закрыта', consentedAt: '1990-01-01', consentText: 'fake', consentTextSha256: 'fake', retentionExpiresAt: '9999-01-01',
    products: [{ sku: 'SKU-1', quantity: 2, pricePerMeter: 0.01, name: 'Tampered', image: 'https://third-party.example.test/personal', passport: 'do-not-save' }],
  })
  assert.equal(result.status, 201)
  assert.deepEqual(result.response, { data: { documentId: 'stub-lead' }, meta: {} })
  assert.equal(f.saved[0].consentText, [consent.title, `Редакция ${consent.version}`, ...consent.sections.flat()].join('\n\n'))
  assert.equal(f.saved[0].consentTextSha256, createHash('sha256').update(f.saved[0].consentText).digest('hex'))
  assert.equal(f.saved[0].consentVersion, consent.version)
  assert.equal(f.saved[0].consentMethod, 'separate-unchecked-checkbox-and-submit')
  assert.equal(f.saved[0].name, 'Тест')
  assert.equal(f.saved[0].comment, 'Запрос')
  assert.equal(f.saved[0].status, 'Новая')
  assert.ok(Date.parse(f.saved[0].consentedAt) >= before)
  assert.ok(Date.parse(f.saved[0].retentionExpiresAt) > before)
  assert.deepEqual(f.saved[0].products[0], { sku: 'SKU-1', quantity: 2, name: 'Труба', material: 'ПВХ', diameter: 16, coilLength: 50, meters: 100, pricePerMeter: 10 })
  assert.equal(f.notifications.length, 1)
})

test('unknown SKU, duplicates and malformed quantities are rejected before persistence', async () => {
  const f = fixture()
  for (const products of [[{ sku: 'UNKNOWN', quantity: 1 }], [{ sku: 'SKU-1', quantity: 1 }, { sku: 'SKU-1', quantity: 2 }], [{ sku: 'SKU-1', quantity: 0 }], [{ sku: 'SKU-1', quantity: 1.5 }], [{ sku: 'SKU-1', quantity: 10000 }], [{ sku: '', quantity: 1 }]]) {
    assert.ok((await f.submit({ ...valid(), products })).response.error)
  }
  assert.equal(f.saved.length, 0)
  assert.equal(f.notifications.length, 0)
})

test('consent evidence has a predictable one-year review deadline and stays private', () => {
  const record = evidence.consentEvidence(new Date('2026-09-23T10:00:00.000Z'))
  assert.equal(record.retentionExpiresAt, '2027-09-23T10:00:00.000Z')
  const schema = require('../src/api/lead/content-types/lead/schema.json')
  for (const name of ['consentText', 'consentTextSha256', 'consentMethod', 'retentionExpiresAt']) assert.equal(schema.attributes[name].private, true)
  const legal = fs.readFileSync(path.join(__dirname, '../../web/src/components/Legal.tsx'), 'utf8')
  assert.match(legal, /import consentDocument from '\.\.\/\.\.\/\.\.\/cms\/src\/api\/lead\/legal\/consent\.json'/)
  const routes = fs.readFileSync(path.join(__dirname, '../src/api/lead/routes/lead.ts'), 'utf8')
  assert.match(routes, /only: \['create'\]/)
})
