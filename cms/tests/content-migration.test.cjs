// npx tsc && node --test tests/content-migration.test.cjs (from cms/)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { prepare } = require('../scripts/prepare-content-migration.cjs')
const { readBundle, migrate } = require('../scripts/migrate-content.cjs')

test('Prepared public bundle is readable by the container user even with private source modes and umask', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpz-migration-modes-'))
  const previousUmask = process.umask(0o077)
  try {
    const publicDir = path.join(dir, 'public')
    fs.mkdirSync(path.join(publicDir, 'images'), { recursive: true })
    fs.mkdirSync(path.join(publicDir, 'documents'))
    const source = path.join(publicDir, 'documents', 'certificate.pdf')
    fs.writeFileSync(source, '%PDF-1.7\nfixture', { mode: 0o600 })
    const seedFile = path.join(dir, 'seed.json')
    fs.writeFileSync(seedFile, JSON.stringify({ version: 1, products: [], articles: [], documents: [{ file: '/documents/certificate.pdf', pages: [] }] }))
    const output = path.join(dir, 'bundle')
    prepare({ output, publicDir, seedFile })
    const mode = file => fs.statSync(file).mode & 0o777
    const manifest = readBundle(output)
    assert.equal(mode(output), 0o755)
    assert.equal(mode(path.join(output, 'assets')), 0o755)
    assert.equal(mode(path.join(output, 'content.json')), 0o644)
    assert.equal(mode(Object.values(manifest.assets)[0].absolute), 0o644)
    assert.equal(mode(source), 0o600, 'Original source permissions are unchanged')
  } finally {
    process.umask(previousUmask)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Checksums reject a modified migration asset before any database writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpz-migration-hash-'))
  try {
    prepare({ output: dir })
    const manifest = readBundle(dir)
    fs.appendFileSync(Object.values(manifest.assets)[0].absolute, 'tampered')
    assert.throws(() => readBundle(dir), /checksum mismatch/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('CMS migrates content/media without publishing drafts, repeats or reseeding deleted records', { timeout: 180000 }, async () => {
  const database = `.tmp/media-migration-test-${process.pid}.db`
  assert.ok(!fs.existsSync(path.resolve(database)), 'Test must use a fresh database')
  process.env.DATABASE_CLIENT = 'sqlite'
  process.env.DATABASE_FILENAME = database
  process.env.STRAPI_TELEMETRY_DISABLED = 'true'
  process.env.STRAPI_DISABLE_UPDATE_NOTIFICATION = 'true'
  process.env.APP_KEYS = 'local-test-key-1,local-test-key-2'
  process.env.ADMIN_JWT_SECRET = 'local-test-admin-jwt-secret-only'
  process.env.API_TOKEN_SALT = 'local-test-api-token-salt-only'
  process.env.TRANSFER_TOKEN_SALT = 'local-test-transfer-salt-only'
  process.env.JWT_SECRET = 'local-test-jwt-secret-only'
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'rpz-migration-test-'))
  prepare({ output: bundle })
  const manifest = readBundle(bundle)
  const { createStrapi } = require('@strapi/strapi')
  const app = await createStrapi({ appDir: process.cwd(), distDir: path.resolve('dist') }).load()
  try {
    const products = app.documents('api::product.product')
    assert.equal((await products.findMany()).length, 0, 'Startup does not seed deleted/empty content')
    const first = manifest.products[0]
    const original = await products.create({ data: { ...first, image: '/images/pipe-gray.jpg' }, status: 'published' })
    await products.update({ documentId: original.documentId, data: { name: 'Неопубликованный редакторский черновик', price: 777 } })
    const summary = await migrate(app, manifest)
    assert.ok(summary.uploaded > 0)
    const published = await products.findOne({ documentId: original.documentId, status: 'published', populate: ['photo'] })
    const draft = await products.findOne({ documentId: original.documentId, status: 'draft', populate: ['photo'] })
    assert.equal(published.name, first.name)
    assert.equal(Number(published.price), Number(first.price))
    assert.equal(draft.name, 'Неопубликованный редакторский черновик')
    assert.equal(Number(draft.price), 777)
    assert.ok(published.photo?.url?.startsWith('/uploads/'))
    assert.ok(published.photo.name.endsWith(`${first.sku}.webp`), 'Migrate the SKU artwork shown by the old frontend, not its hidden shared-photo fallback')
    assert.equal(published.photo.id, draft.photo.id)
    assert.equal((await products.findMany({ status: 'published' })).length, 16)
    const articles = await app.documents('api::article.article').findMany({ status: 'published', populate: ['image'] })
    assert.equal(articles.length, 7)
    for (const article of articles) {
      const seed = manifest.articles.find(item => item.slug === article.slug)
      assert.deepEqual(article.sections, seed.sections)
      assert.deepEqual(article.sources, seed.sources)
      assert.deepEqual(article.related, seed.related)
      assert.ok(article.image?.url?.startsWith('/uploads/'))
    }
    const documents = await app.documents('api::document.document').findMany({ status: 'published', populate: ['file', 'pages'] })
    assert.equal(documents.length, 6)
    assert.equal(documents.reduce((count, item) => count + item.pages.length, 0), 26)
    assert.ok(documents.every(item => item.file.mime === 'application/pdf'))
    const countBefore = await app.db.query('plugin::upload.file').count()
    assert.equal(countBefore, 59)
    assert.equal(app.contentTypes['api::site-image.site-image'], undefined)
    const repeat = await migrate(app, manifest)
    assert.equal(repeat.uploaded, 0)
    assert.equal(repeat.created, 0)
    assert.equal(repeat.attached, 0)
    assert.equal(repeat.skipped, 36)
    assert.equal(await app.db.query('plugin::upload.file').count(), countBefore)
    await app.documents('api::article.article').delete({ documentId: articles[0].documentId })
    await migrate(app, manifest)
    assert.equal((await app.documents('api::article.article').findMany({ status: 'published' })).length, 6)

    await assert.rejects(app.documents('api::document.document').update({ documentId: documents[0].documentId, data: { file: published.photo.id } }), /только файл PDF/)
    const fakePdf = path.join(bundle, 'forged.pdf')
    fs.writeFileSync(fakePdf, '<html>not a PDF</html>')
    await assert.rejects(app.plugin('upload').service('upload').upload({ data: {}, files: { filepath: fakePdf, originalFilename: 'forged.pdf', mimetype: 'application/pdf', size: fs.statSync(fakePdf).size } }), /сигнатура/)

    const publicRole = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } })
    const permissions = await app.db.query('plugin::users-permissions.permission').findMany({ where: { role: publicRole.id } })
    assert.ok(permissions.some(item => item.action === 'api::article.article.find'))
    assert.ok(permissions.some(item => item.action === 'api::document.document.find'))
    assert.ok(!permissions.some(item => /upload|article\.(create|update|delete)|document\.(create|update|delete)/.test(item.action)))
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}`
    const visible = await fetch(`${base}/api/products?status=draft&populate=photo`).then(response => response.json())
    assert.equal(visible.data.find(item => item.sku === first.sku).name, first.name, 'Public status=draft cannot expose pending edits')
    const visibleArticle = await fetch(`${base}/api/articles?status=draft&populate=image`).then(response => response.json())
    assert.equal(visibleArticle.data.length, 6)
    assert.ok(visibleArticle.data.every(item => item.image && !Object.hasOwn(item, 'publicationInputSha256') && !Object.hasOwn(item, 'imageGeneration')))
    assert.equal((await fetch(`${base}/api/documents?populate[0]=file&populate[1]=pages`)).status, 200)
    assert.equal((await fetch(`${base}/api/site-images?populate=image&status=draft`)).status, 404)
    assert.equal((await fetch(`${base}/api/articles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) })).status, 403)
    assert.equal((await fetch(`${base}/api/upload`, { method: 'POST' })).status, 403)
    console.log(JSON.stringify({ migrated: summary, repeat, mediaCount: countBefore }))
  } finally {
    // This fresh test DB contains only files uploaded by this test; each filename
    // is randomized by Strapi, so existing developer uploads are untouched.
    for (const file of await app.db.query('plugin::upload.file').findMany()) await app.plugin('upload').service('upload').remove(file)
    await app.destroy()
    fs.rmSync(path.resolve(database), { force: true })
    fs.rmSync(bundle, { recursive: true, force: true })
  }
})
