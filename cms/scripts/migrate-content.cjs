#!/usr/bin/env node
// Run from the CMS directory. Explicit one-time migration; never a startup seed.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const STATE_KEY = 'content-media-v1'
const LEGACY_SHARED_PRODUCT_IMAGES = new Set([
  '/images/pipe-gray.jpg', '/images/pipe-black.jpg', '/images/pipe-orange.jpg',
  '/images/pipe-orange.png', '/images/pipe-orange-original.jpg',
])

function readBundle(bundleDirectory) {
  const root = fs.realpathSync(bundleDirectory)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8'))
  if (manifest.version !== 1 || !manifest.assets || !Array.isArray(manifest.products) || !Array.isArray(manifest.articles) || !Array.isArray(manifest.documents)) throw new Error('Invalid content migration manifest')
  // Check every byte before the first write, including currently unused media.
  for (const asset of Object.values(manifest.assets)) {
    const absolute = fs.realpathSync(path.resolve(root, asset.path))
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error('Asset escapes migration bundle')
    const bytes = fs.readFileSync(absolute)
    if (bytes.length !== asset.size || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Asset checksum mismatch: ${asset.originalName}`)
    asset.absolute = absolute
  }
  return manifest
}

async function migrate(app, manifest) {
  const store = app.store({ type: 'core', name: 'rusplast-migration' })
  const state = (await store.get({ key: STATE_KEY })) || { version: 1, completed: [], assets: {} }
  const completed = new Set(state.completed)
  const result = { uploaded: 0, reused: 0, created: 0, attached: 0, skipped: 0 }
  const save = async () => {
    state.completed = [...completed]
    await store.set({ key: STATE_KEY, value: state })
  }
  const media = async (reference, alternativeText = '') => {
    const asset = manifest.assets[reference]
    if (!asset) throw new Error(`Legacy asset is absent from bundle: ${reference}`)
    const files = app.db.query('plugin::upload.file')
    const name = `rpz-${asset.sha256.slice(0, 20)}-${asset.originalName}`
    const knownId = state.assets[asset.sha256]
    let existing = knownId ? await files.findOne({ where: { id: knownId } }) : null
    // Covers an interrupted process after upload but before ledger persistence.
    if (!existing) existing = await files.findOne({ where: { name, mime: asset.mime } })
    if (existing) { state.assets[asset.sha256] = existing.id; result.reused++; return existing.id }
    const [uploaded] = await app.plugin('upload').service('upload').upload({
      data: { fileInfo: { name, alternativeText, caption: `Импорт исходного файла ${asset.originalName}` } },
      files: { filepath: asset.absolute, originalFilename: asset.originalName, mimetype: asset.mime, size: asset.size },
    })
    state.assets[asset.sha256] = uploaded.id
    result.uploaded++
    await save()
    return uploaded.id
  }

  // All draft and published versions are updated independently at relation level.
  // Publishing an existing document here would publish an editor's pending draft.
  const processRecord = async ({ uid, identity, key, data, mediaFields }) => {
    if (completed.has(key)) { result.skipped++; return }
    const query = app.db.query(uid)
    const rows = await query.findMany({ where: identity, populate: Object.keys(mediaFields) })
    if (rows.length) {
      for (const row of rows) {
        const patch = {}
        for (const [field, resolve] of Object.entries(mediaFields)) {
          if (!row[field] || (Array.isArray(row[field]) && !row[field].length)) patch[field] = await resolve(row)
        }
        if (Object.keys(patch).length) {
          await query.update({ where: { id: row.id }, data: patch })
          result.attached++
        }
      }
    } else {
      const resolved = {}
      for (const [field, resolve] of Object.entries(mediaFields)) resolved[field] = await resolve(data)
      await app.documents(uid).create({ data: { ...data, ...resolved }, status: 'published' })
      result.created++
    }
    completed.add(key)
    await save()
  }

  for (const item of manifest.products) {
    await processRecord({ uid: 'api::product.product', identity: { sku: item.sku }, key: `product:${item.sku}`, data: item,
      // Before CMS migration the frontend replaced these old shared photos with
      // SKU-specific catalog artwork. Preserve that visible catalog on import,
      // while retaining genuinely customized legacy image paths and media.
      mediaFields: { photo: row => media(!row.image || LEGACY_SHARED_PRODUCT_IMAGES.has(row.image) ? item.image : row.image, row.name || item.name) } })
  }
  for (const item of manifest.documents) {
    const { file, pages, ...data } = item
    await processRecord({ uid: 'api::document.document', identity: { slug: item.slug }, key: `document:${item.slug}`, data,
      mediaFields: { file: () => media(file, item.title), pages: async () => {
        const ids = []
        for (const [index, reference] of pages.entries()) ids.push(await media(reference, `${item.title}, страница ${index + 1}`))
        return ids
      } } })
  }
  for (const item of manifest.articles) {
    const { image, publishedAt, modifiedAt, ...data } = item
    data.publishedOn = publishedAt?.slice(0, 10) || '2026-09-18'
    if (modifiedAt) data.modifiedOn = modifiedAt.slice(0, 10)
    await processRecord({ uid: 'api::article.article', identity: { slug: item.slug }, key: `article:${item.slug}`, data,
      mediaFields: { image: () => media(image, item.imageAlt) } })
  }
  // Legacy descriptors only: presentation images live in Media Library, with
  // no separate content collection. Keep the original ledger keys for upgrades.
  for (const item of manifest.siteImages || []) {
    const key = `site-image:${item.slug}`
    if (completed.has(key)) { result.skipped++; continue }
    await media(item.image, item.imageAlt)
    completed.add(key)
    await save()
  }
  return result
}

async function main() {
  const args = process.argv.slice(2)
  const bundleIndex = args.indexOf('--bundle')
  if (bundleIndex < 0 || !args[bundleIndex + 1]) throw new Error('Usage: node scripts/migrate-content.cjs --bundle /path/to/bundle [--apply]')
  const manifest = readBundle(args[bundleIndex + 1])
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ validated: true, products: manifest.products.length, articles: manifest.articles.length, documents: manifest.documents.length, siteImages: manifest.siteImages?.length || 0, assets: Object.keys(manifest.assets).length, applied: false }))
    return
  }
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const context = fs.existsSync(path.resolve('dist/src/index.js')) ? { appDir: process.cwd(), distDir: path.resolve('dist') } : await compileStrapi()
  const app = await createStrapi(context).load()
  try { console.log(JSON.stringify(await migrate(app, manifest))) }
  finally { await app.destroy() }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { readBundle, migrate }
