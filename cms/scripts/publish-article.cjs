/** Fixed private CLI used over SSH; never exposed as an unauthenticated route. */
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const { resolve } = require('node:path')
const sharp = require('sharp')
const { ensureFolder, moveFileToFolder, ROOT_FOLDERS } = require('./lib/media-folders.cjs')
const ORIGIN = 'https://rusplast-zavod.ru'
const MEDIA_ORIGIN = 'https://cms.rusplast-zavod.ru'
const UID = 'api::article.article'
const fields = ['slug', 'title', 'seoTitle', 'description', 'category', 'imageAlt', 'intro', 'takeaway', 'sections', 'sources', 'related', 'author']
const canonical = value => JSON.stringify(sort(value))
function sort(value) {
  if (Array.isArray(value)) return value.map(sort)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]))
  return value
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex')
function normalize(entry) {
  const article = Object.fromEntries(fields.map(key => [key, entry[key]]))
  article.image = new URL(entry.image.url, MEDIA_ORIGIN).href
  article.publishedAt = entry.publishedOn
  if (entry.modifiedOn) article.modifiedAt = entry.modifiedOn
  return article
}
function receipt(entry, bundle) {
  const article = normalize(entry)
  if (digest(article) !== digest({ ...bundle.article, image: article.image })) throw new Error('CMS content changed after preparation; preserve manual edit and stop')
  return { article, slug: article.slug, url: `${ORIGIN}/blog/${article.slug}`, sha256: digest(article),
    inputSha256: bundle.inputSha256, documentId: entry.documentId, imageId: entry.image.id }
}
async function organizeGeneratedCover(app, imageId, expectedName) {
  const image = await app.db.query('plugin::upload.file').findOne({ where: { id: imageId }, populate: ['folder'] })
  // Repair only this publisher's own cover left in the root by an older run.
  // Renamed files and folders selected by an editor belong to the editor.
  if (!image || image.name !== expectedName || image.folder || image.folderPath !== '/') return
  const folder = await ensureFolder(app, ROOT_FOLDERS.articles)
  await moveFileToFolder(app, image, folder)
}
async function publish(app, bundle, imagePath) {
  const { article, imageSha256, inputSha256 } = bundle
  if (!article || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) || article.image !== 'generated-cover') throw new Error('Invalid publication payload')
  if (digest({ article, imageSha256 }) !== inputSha256 || !/^[a-f0-9]{64}$/.test(imageSha256)) throw new Error('Publication input digest mismatch')
  const data = await fs.readFile(imagePath)
  if (data.length < 80000 || data.length > 30000000 || crypto.createHash('sha256').update(data).digest('hex') !== imageSha256) throw new Error('Cover bytes or digest invalid')
  const metadata = await sharp(data, { limitInputPixels: 20000000 }).metadata()
  if (metadata.format !== 'png' || metadata.width < 1400 || metadata.height < 800 || metadata.width / metadata.height < 1.2 || metadata.width / metadata.height > 2) throw new Error('Cover must be landscape PNG, at least 1400x800')
  await sharp(data, { limitInputPixels: 20000000 }).stats() // Full decoder validation, not just header sniffing.
  const name = `${article.slug}-${imageSha256.slice(0, 16)}.png`
  const documents = app.documents(UID)
  const query = { filters: { slug: article.slug }, populate: ['image'] }
  const published = await documents.findFirst({ ...query, status: 'published' })
  if (published) {
    if (published.publicationInputSha256 !== inputSha256) throw new Error('Slug already published with different content; manual update required')
    // A saved editor draft may exist beside this published version: never publish it on retry.
    const result = receipt(published, bundle)
    await organizeGeneratedCover(app, published.image.id, name)
    return result
  }
  let draft = await documents.findFirst({ ...query, status: 'draft' })
  if (draft) {
    if (draft.publicationInputSha256 !== inputSha256) throw new Error('CMS draft belongs to another revision; manual draft preserved')
    receipt(draft, bundle) // Stops if a human changed the draft after the failed first attempt.
    await organizeGeneratedCover(app, draft.image.id, name)
  } else {
    const uploads = app.db.query('plugin::upload.file')
    let image = await uploads.findOne({ where: { name } })
    if (!image) {
      const folder = await ensureFolder(app, ROOT_FOLDERS.articles)
      ;[image] = await app.plugin('upload').service('upload').upload({
        data: { fileInfo: { name, alternativeText: article.imageAlt, caption: 'Сгенерированная редакционная иллюстрация', folder: folder.id } },
        files: { filepath: imagePath, originalFilename: name, mimetype: 'image/png', size: data.length },
      })
    } else {
      await organizeGeneratedCover(app, image.id, name)
    }
    if (!image?.id || !image.url?.startsWith('/uploads/') || image.width < 1400 || image.height < 800) throw new Error('Media Library upload did not return a valid cover')
    const values = Object.fromEntries(fields.map(key => [key, article[key]]))
    draft = await documents.create({ status: 'draft', data: {
      ...values, image: image.id, publishedOn: article.publishedAt,
      ...(article.modifiedAt ? { modifiedOn: article.modifiedAt } : {}),
      publicationInputSha256: inputSha256,
      imageGeneration: { ...bundle.imageGeneration, imageSha256, generated: true, uploadedAt: new Date().toISOString() },
    }, populate: ['image'] })
    receipt(draft, bundle)
  }
  await documents.publish({ documentId: draft.documentId })
  const live = await documents.findOne({ documentId: draft.documentId, status: 'published', populate: ['image'] })
  if (!live?.image) throw new Error('Published CMS entry unavailable')
  return receipt(live, bundle)
}
async function main() {
  const [payloadPath, coverPath] = process.argv.slice(2)
  if (!payloadPath || !coverPath) throw new Error('Usage: publish-article.cjs article.json cover.png')
  const bundle = JSON.parse(await fs.readFile(resolve(payloadPath), 'utf8'))
  const { compileStrapi, createStrapi } = require('@strapi/strapi')
  const hasCompiledApp = await fs.access(resolve('dist/src/index.js')).then(() => true, () => false)
  if (process.env.NODE_ENV === 'production' && !hasCompiledApp) throw new Error('Compiled CMS application is missing; deploy the CMS build first')
  const context = hasCompiledApp ? { appDir: process.cwd(), distDir: resolve('dist') } : await compileStrapi()
  const app = await createStrapi(context).load()
  let result
  try { result = await publish(app, bundle, resolve(coverPath)) }
  finally { await app.destroy() }
  console.log(JSON.stringify(result))
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { publish, normalize, digest, canonical, receipt }
