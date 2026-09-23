/** Run with the OLD CMS build, before removing the site-image model. */
const fs = require('node:fs/promises')
const { resolve } = require('node:path')
const crypto = require('node:crypto')

const UID = 'api::site-image.site-image'
const FILE_UID = 'plugin::upload.file'

async function listDocuments(app) {
  const byDocument = new Map()
  for (const status of ['draft', 'published']) {
    for (let start = 0; ; start += 100) {
      const entries = await app.documents(UID).findMany({ status, start, limit: 100, fields: ['documentId', 'slug', 'title'], sort: 'documentId:asc' })
      for (const entry of entries) {
        const existing = byDocument.get(entry.documentId)
        if (existing) existing.statuses.push(status)
        else byDocument.set(entry.documentId, { documentId: entry.documentId, slug: entry.slug, title: entry.title, statuses: [status] })
      }
      if (entries.length < 100) break
    }
  }
  return [...byDocument.values()].sort((a, b) => a.documentId.localeCompare(b.documentId))
}

async function mediaSnapshot(app) {
  const files = await app.db.query(FILE_UID).findMany({ select: ['id', 'url', 'hash'], orderBy: { id: 'asc' } })
  return {
    count: files.length,
    sha256: crypto.createHash('sha256').update(JSON.stringify(files.map(({ id, url, hash }) => ({ id, url, hash })))).digest('hex'),
  }
}

async function linkedMediaCount(app, trx) {
  const { name, morphColumn } = app.db.metadata.get(FILE_UID).attributes.related.joinTable
  const query = app.db.getConnection(name).where(morphColumn.typeColumn.name, UID).count({ count: '*' }).first()
  if (trx) query.transacting(trx)
  const row = await query
  return Number(row.count)
}

async function retire(app, { apply = false, expectedDocuments = 7 } = {}) {
  if (!app.contentTypes[UID]) throw new Error('Run retirement with the old CMS build while the site-image model still exists')
  const documents = await listDocuments(app)
  const before = await mediaSnapshot(app)
  const linkedBefore = await linkedMediaCount(app)
  const plan = { mode: apply ? 'apply' : 'dry-run', documentCount: documents.length, documents, media: before, mediaLinks: linkedBefore }
  if (!apply) return plan
  if (documents.length !== 0 && documents.length !== expectedDocuments) throw new Error(`Expected ${expectedDocuments} site-image documents or an already empty collection; found ${documents.length}`)
  return app.db.transaction(async ({ trx }) => {
    // Guard against an editor adding/removing one of these records after the plan.
    const current = await listDocuments(app)
    if (JSON.stringify(current) !== JSON.stringify(documents)) throw new Error('Site-image documents changed during retirement; no changes applied')
    let deletedVersions = 0
    for (const { documentId } of documents) {
      const result = await app.documents(UID).delete({ documentId })
      deletedVersions += result.entries.length
    }
    if ((await listDocuments(app)).length !== 0) throw new Error('Site-image documents remain after native deletion')
    if (await linkedMediaCount(app, trx) !== 0) throw new Error('Site-image media references remain; rollback retirement')
    const after = await mediaSnapshot(app)
    if (after.count !== before.count || after.sha256 !== before.sha256) throw new Error('Uploaded file IDs, URLs or hashes changed; rollback retirement')
    return { ...plan, deletedDocuments: documents.length, deletedVersions, mediaLinksAfter: 0, mediaPreserved: true, alreadyRetired: documents.length === 0 }
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/retire-site-images.cjs [--apply] (dry-run by default)')
  const { createStrapi } = require('@strapi/strapi')
  await fs.access(resolve('dist/src/index.js')).catch(() => { throw new Error('Compiled old CMS build is required') })
  const app = await createStrapi({ appDir: process.cwd(), distDir: resolve('dist') }).load()
  try { console.log(JSON.stringify(await retire(app, { apply: args.includes('--apply') }))) }
  finally { await app.destroy() }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { UID, retire, listDocuments, mediaSnapshot, linkedMediaCount }
