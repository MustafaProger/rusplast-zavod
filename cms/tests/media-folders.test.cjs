// From cms/: npx tsc && node --test tests/media-folders.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { organizeMedia, documentFolderName, uniqueDocumentFolders } = require('../scripts/organize-media.cjs')
const { ensureFolder, ROOT_FOLDERS } = require('../scripts/lib/media-folders.cjs')
const seed = require('../src/data/content-migration.json')

test('Document folders include distinct numbers and respect Strapi folder naming rules', () => {
  assert.equal(documentFolderName(seed.documents[0]), 'Сертификат соответствия ЕАЭС — № RU C-RU.НК07.В.00023-25')
  assert.equal(documentFolderName(seed.documents[2]), 'Информационное письмо — № 198-25')
  assert.equal(documentFolderName(seed.documents[3]), 'Протокол № 101С-ЭП-2025')
  const names = uniqueDocumentFolders([{ documentId: 'a', slug: 'first', title: 'Сертификат' }, { documentId: 'b', slug: 'second', title: 'Сертификат' }])
  assert.equal(names.size, 2)
  assert.notEqual(names.get('a'), names.get('b'))
})

test('Native folders organize all 59 assets idempotently without changing file identity, content relations, drafts or custom names', { timeout: 180000 }, async () => {
  const database = `.tmp/media-folders-test-${process.pid}.db`
  assert.ok(!fs.existsSync(path.resolve(database)), 'Test must use a new isolated database')
  Object.assign(process.env, {
    DATABASE_CLIENT: 'sqlite', DATABASE_FILENAME: database,
    STRAPI_TELEMETRY_DISABLED: 'true', STRAPI_DISABLE_UPDATE_NOTIFICATION: 'true',
    APP_KEYS: 'local-folders-test-key-1,local-folders-test-key-2', ADMIN_JWT_SECRET: 'local-folders-admin-secret',
    API_TOKEN_SALT: 'local-folders-api-salt', TRANSFER_TOKEN_SALT: 'local-folders-transfer-salt', JWT_SECRET: 'local-folders-jwt-secret',
  })
  const { createStrapi } = require('@strapi/strapi')
  const app = await createStrapi({ appDir: process.cwd(), distDir: path.resolve('dist') }).load()
  try {
    const uploads = app.db.query('plugin::upload.file')
    const folders = app.db.query('plugin::upload.folder')
    const assets = new Map()
    // Metadata fixtures mirror the imported files. No real uploads are created
    // or deleted, so the developer's public/uploads directory is untouched.
    async function asset(reference) {
      if (assets.has(reference)) return assets.get(reference)
      const hash = crypto.createHash('sha256').update(reference).digest('hex')
      const ext = path.extname(reference)
      const original = path.basename(reference)
      const file = await uploads.create({ data: {
        name: `rpz-${hash.slice(0, 20)}-${original}`, hash, ext,
        mime: ext === '.pdf' ? 'application/pdf' : `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`,
        url: `/uploads/${hash}${ext}`, size: 50, provider: 'local', folderPath: '/',
        alternativeText: `Описание ${original}`, caption: `Импорт исходного файла ${original}`,
        formats: ext === '.pdf' ? null : { thumbnail: { url: `/uploads/thumbnail_${hash}${ext}`, hash: `thumbnail_${hash}`, ext } },
      } })
      assets.set(reference, file)
      return file
    }
    for (const item of seed.products) await app.documents('api::product.product').create({ status: 'published', data: { ...item, photo: (await asset(item.image)).id } })
    for (const item of seed.articles) {
      const { image, publishedAt, modifiedAt, ...data } = item
      await app.documents('api::article.article').create({ status: 'published', data: { ...data, image: (await asset(image)).id, publishedOn: publishedAt?.slice(0, 10) || '2026-09-18', ...(modifiedAt ? { modifiedOn: modifiedAt.slice(0, 10) } : {}) } })
    }
    const documentEntries = []
    for (const item of seed.documents) {
      const { file, pages, ...data } = item
      const pageIds = []
      for (const page of pages) pageIds.push((await asset(page)).id)
      documentEntries.push(await app.documents('api::document.document').create({ status: 'published', data: { ...data, file: (await asset(file)).id, pages: pageIds } }))
    }
    for (const name of ['pipe-gray.jpg', 'pipe-black.jpg', 'pipe-orange-original.jpg', 'optimized/hero-pipes-1280.webp']) await asset(`/images/${name}`)
    assert.equal(await uploads.count(), 59)
    assert.equal(await folders.count(), 0)

    const publishedArticle = await app.documents('api::article.article').findFirst({ status: 'published', populate: ['image'] })
    await app.documents('api::article.article').update({ documentId: publishedArticle.documentId, data: { title: 'Черновик редактора, который ещё нельзя публиковать' } })
    const custom = assets.get(seed.products[0].image)
    await app.plugin('upload').service('upload').updateFileInfo(custom.id, { name: 'Моя отретушированная фотография.webp' })
    const unknown = await asset('/uploads/editor-unattached-photo.png')
    // A root upload with even a migration-looking name is left untouched unless linked.
    const customBlog = await ensureFolder(app, ROOT_FOLDERS.articles)
    assert.equal((await ensureFolder(app, ROOT_FOLDERS.articles)).id, customBlog.id)
    await ensureFolder(app, 'Папка редактора')
    const identities = async () => (await uploads.findMany({ orderBy: { id: 'asc' } })).map(file => Object.fromEntries(['id', 'url', 'hash', 'ext', 'mime', 'formats', 'provider', 'size', 'alternativeText', 'caption'].map(key => [key, file[key]])))
    const relations = async () => {
      const result = {}
      for (const [uid, fields] of [['api::article.article', ['image']], ['api::product.product', ['photo']], ['api::document.document', ['file', 'pages']]]) {
        result[uid] = (await app.db.query(uid).findMany({ populate: fields, orderBy: { id: 'asc' } })).map(record => ({
          ...record, ...Object.fromEntries(fields.map(field => [field, Array.isArray(record[field]) ? record[field].map(file => file.id) : record[field]?.id])),
        }))
      }
      return result
    }
    const beforeIdentity = await identities()
    const beforeRelations = await relations()
    const beforeFiles = await uploads.findMany({ populate: ['folder'], orderBy: { id: 'asc' } })
    const folderCount = await folders.count()
    const plan = await organizeMedia(app)
    assert.equal(plan.applied, false)
    assert.deepEqual(plan.summary.groups, { 'Товары': 16, 'Блог': 7, 'Документы': 32, 'Оформление сайта': 4 })
    assert.equal(plan.summary.createFolders, 9)
    assert.equal(plan.summary.moveFiles, 59)
    assert.equal(plan.summary.renameFiles, 58)
    assert.equal(plan.summary.untouchedFiles, 1)
    assert.equal(await folders.count(), folderCount)
    assert.deepEqual(await uploads.findMany({ populate: ['folder'], orderBy: { id: 'asc' } }), beforeFiles, 'Dry-run performs no file writes')
    const first = await organizeMedia(app, { apply: true })
    assert.equal(first.applied, true)
    assert.deepEqual(await identities(), beforeIdentity)
    assert.deepEqual(await relations(), beforeRelations)
    assert.equal((await uploads.findOne({ where: { id: custom.id } })).name, 'Моя отретушированная фотография.webp')
    assert.equal((await uploads.findOne({ where: { id: unknown.id }, populate: ['folder'] })).folder, null)
    const docsRoot = await folders.findOne({ where: { name: ROOT_FOLDERS.documents, parent: null } })
    const documentFolders = await folders.findMany({ where: { parent: docsRoot.id }, populate: ['files'] })
    assert.equal(documentFolders.length, 6)
    assert.deepEqual(documentFolders.map(folder => folder.files.length).sort((a, b) => a - b), [2, 2, 3, 7, 7, 11])
    assert.ok(documentFolders.every(folder => folder.files.every(file => file.folderPath === folder.path)))
    assert.ok(documentFolders.every(folder => folder.files.filter(file => file.mime === 'application/pdf').length === 1))
    assert.ok(documentFolders.flatMap(folder => folder.files).some(file => /страница 10\.jpg$/.test(file.name)))
    const organized = await uploads.findMany({ orderBy: { id: 'asc' } })
    const repeat = await organizeMedia(app, { apply: true })
    assert.equal(repeat.summary.createFolders, 0)
    assert.equal(repeat.summary.moveFiles, 0)
    assert.equal(repeat.summary.renameFiles, 0)
    assert.deepEqual(await uploads.findMany({ orderBy: { id: 'asc' } }), organized, 'Second apply does not even update timestamps')

    // A newly edited draft can use a different image without publishing it.
    const draftImage = await asset('/draft-new-cover.png')
    await app.documents('api::article.article').update({ documentId: publishedArticle.documentId, data: { image: draftImage.id } })
    await organizeMedia(app, { apply: true })
    assert.equal((await uploads.findOne({ where: { id: draftImage.id }, populate: ['folder'] })).folder.id, customBlog.id)
    // A shared file is assigned once, by documented document > article > product priority.
    const sharedPage = assets.get(seed.documents[0].pages[0])
    await app.documents('api::article.article').update({ documentId: publishedArticle.documentId, data: { image: sharedPage.id } })
    const sharedPlan = await organizeMedia(app, { apply: true })
    assert.ok(sharedPlan.conflicts.some(conflict => conflict.id === sharedPage.id && conflict.kept.startsWith('document:') && conflict.alsoUsedBy.startsWith('article:')))
    assert.deepEqual(sharedPlan.files.find(file => file.id === sharedPage.id).target, [ROOT_FOLDERS.documents, documentFolderName(seed.documents[0])])
    assert.equal((await app.documents('api::article.article').findOne({ documentId: publishedArticle.documentId, status: 'published', populate: ['image'] })).image.id, publishedArticle.image.id)
    assert.equal((await uploads.findOne({ where: { id: draftImage.id }, populate: ['folder'] })).folder.id, customBlog.id, 'Unlinked files keep their existing location')
    console.log(JSON.stringify({ first: first.summary, repeat: repeat.summary, documentFolders: documentFolders.map(folder => ({ name: folder.name, files: folder.files.length })) }))
  } finally {
    await app.destroy()
    fs.rmSync(path.resolve(database), { force: true })
    fs.rmSync(path.resolve(`${database}-wal`), { force: true })
    fs.rmSync(path.resolve(`${database}-shm`), { force: true })
  }
})
