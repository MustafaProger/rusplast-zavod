#!/usr/bin/env node
// Read-only plan by default. Run from cms/ with --apply after reviewing the plan.
const fs = require('node:fs')
const path = require('node:path')
const { ROOT_FOLDERS, folderName, ensureFolder, moveFileToFolder } = require('./lib/media-folders.cjs')
const FILE_UID = 'plugin::upload.file'
const FOLDER_UID = 'plugin::upload.folder'
const DECOR = Object.freeze({
  'pipe-gray.jpg': 'Бухта серой гофрированной трубы ПВХ',
  'pipe-black.jpg': 'Бухта чёрной гофрированной трубы ПНД',
  'pipe-orange-original.jpg': 'Бухта оранжевой гофрированной трубы ПНД',
  'hero-pipes-1280.webp': 'Бухты труб на главной странице',
})
const cleanTitle = value => String(value || '').replace(/[\\/\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
const namedFile = (title, suffix, file) => `${cleanTitle(title).slice(0, 200)}${suffix}${file.ext || path.extname(file.name || '')}`
const isDefaultName = (file, slug = '') => /^rpz-[a-f0-9]{20}-/.test(file.name)
  || (slug && new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-f0-9]{16}\\.png$`).test(file.name))

function documentFolderName(document) {
  const title = cleanTitle(document.title || document.slug)
  // Generic certificate/letter titles get the distinguishing subtitle number.
  const number = document.subtitle?.match(/№\s*([^·]+)/)?.[1]?.split(/\s+от\s+/)[0]?.trim()
  return folderName(number && !/№/.test(title) ? `${title} — № ${number}` : title)
}

function uniqueDocumentFolders(documents) {
  const names = new Map()
  const groups = new Map()
  for (const document of documents) {
    const key = document.documentId || document.slug || String(document.id)
    if (names.has(key)) continue // Published version is encountered first.
    const name = documentFolderName(document)
    names.set(key, name)
    groups.set(name, [...(groups.get(name) || []), { key, slug: document.slug || key }])
  }
  for (const [name, group] of groups) {
    if (group.length > 1) for (const item of group) names.set(item.key, folderName(`${name.slice(0, 140)} — ${item.slug.slice(0, 90)}`))
  }
  return names
}

async function buildPlan(app) {
  const files = await app.db.query(FILE_UID).findMany({ populate: ['folder'], orderBy: { id: 'asc' } })
  const folders = await app.db.query(FOLDER_UID).findMany({ populate: ['parent'], orderBy: { id: 'asc' } })
  const fileById = new Map(files.map(file => [file.id, file]))
  const records = async (uid, populate) => {
    const rows = await app.db.query(uid).findMany({ populate, orderBy: { id: 'asc' } })
    // Preserve both draft and published media, but prefer a published title.
    return rows.sort((a, b) => Number(Boolean(b.publishedAt)) - Number(Boolean(a.publishedAt)) || a.id - b.id)
  }
  const documents = await records('api::document.document', ['file', 'pages'])
  const articles = await records('api::article.article', ['image'])
  const products = await records('api::product.product', ['photo'])
  const documentNames = uniqueDocumentFolders(documents)
  const assignments = new Map()
  const folderPaths = Object.values(ROOT_FOLDERS).map(name => [name])
  const conflicts = []
  const assign = (media, target, name, owner, slug = '') => {
    if (!media?.id) return
    const file = fileById.get(media.id)
    if (!file) throw new Error(`Linked media ${media.id} is missing`)
    const previous = assignments.get(file.id)
    if (previous) {
      if (previous.owner !== owner) conflicts.push({ id: file.id, kept: previous.owner, alsoUsedBy: owner })
      return
    }
    assignments.set(file.id, { id: file.id, owner, target, name: isDefaultName(file, slug) ? name : file.name })
  }
  // Shared media can live in only one folder. Explicit priority avoids copies.
  for (const document of documents) {
    const key = document.documentId || document.slug || String(document.id)
    const target = [ROOT_FOLDERS.documents, documentNames.get(key)]
    folderPaths.push(target)
    assign(document.file, target, namedFile(document.title, ' — оригинал', document.file || {}), `document:${key}`)
    for (const [index, page] of (document.pages || []).entries()) {
      assign(page, target, namedFile(document.title, ` — страница ${String(index + 1).padStart(2, '0')}`, page), `document:${key}`)
    }
  }
  for (const article of articles) assign(article.image, [ROOT_FOLDERS.articles], namedFile(article.title, '', article.image || {}), `article:${article.documentId || article.slug}`, article.slug)
  for (const product of products) assign(product.photo, [ROOT_FOLDERS.products], namedFile(`${product.sku} — ${product.name}`, '', product.photo || {}), `product:${product.documentId || product.sku}`)
  for (const file of files) {
    const original = file.name.match(/^rpz-[a-f0-9]{20}-(.+)$/)?.[1]
      || file.caption?.match(/^Импорт исходного файла (.+)$/)?.[1]
    if (DECOR[original]) assign(file, [ROOT_FOLDERS.decor], namedFile(DECOR[original], '', file), `decor:${original}`)
  }
  const folderByKey = new Map()
  for (const folder of folders) folderByKey.set(`${folder.parent?.id || 0}\0${folder.name}`, folder)
  const resolveFolder = target => {
    let folder = null
    for (const name of target) {
      folder = folderByKey.get(`${folder?.id || 0}\0${name}`)
      if (!folder) return null
    }
    return folder
  }
  const plannedFolders = [...new Map(folderPaths.map(target => [JSON.stringify(target), target])).values()]
    .map(target => ({ target, existingId: resolveFolder(target)?.id || null }))
  const entries = [...assignments.values()].map(item => {
    const file = fileById.get(item.id)
    const folder = resolveFolder(item.target)
    return { ...item, oldName: file.name, currentFolderId: file.folder?.id || null,
      move: !folder || file.folder?.id !== folder.id || file.folderPath !== folder.path,
      rename: file.name !== item.name, url: file.url, hash: file.hash }
  })
  return { folders: plannedFolders, files: entries, conflicts,
    untouched: files.filter(file => !assignments.has(file.id)).map(file => ({ id: file.id, name: file.name })),
    summary: { totalFiles: files.length, organizedFiles: entries.length, untouchedFiles: files.length - entries.length,
      createFolders: plannedFolders.filter(folder => !folder.existingId).length,
      moveFiles: entries.filter(file => file.move).length, renameFiles: entries.filter(file => file.rename).length,
      groups: Object.fromEntries(Object.values(ROOT_FOLDERS).map(name => [name, entries.filter(file => file.target[0] === name).length])) } }
}

async function organizeMedia(app, { apply = false } = {}) {
  const plan = await buildPlan(app)
  if (!apply) return { applied: false, ...plan }
  const actualFolders = new Map()
  for (const { target } of plan.folders) {
    let folder = null
    for (let depth = 0; depth < target.length; depth++) {
      const key = JSON.stringify(target.slice(0, depth + 1))
      if (!actualFolders.has(key)) actualFolders.set(key, await ensureFolder(app, target[depth], folder))
      folder = actualFolders.get(key)
    }
  }
  for (const file of plan.files) {
    if (!file.move && !file.rename) continue
    const current = await app.db.query(FILE_UID).findOne({ where: { id: file.id } })
    // An editor's rename after planning must not be lost.
    if (!current || current.name !== file.oldName || current.url !== file.url || current.hash !== file.hash) throw new Error(`Media ${file.id} changed while planning; rerun organization`)
    const updated = await moveFileToFolder(app, current, actualFolders.get(JSON.stringify(file.target)), { name: file.name })
    if (updated.id !== current.id || updated.url !== current.url || updated.hash !== current.hash || updated.ext !== current.ext) throw new Error(`Media ${file.id} identity changed unexpectedly`)
  }
  return { applied: true, ...plan }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Usage: node scripts/organize-media.cjs [--dry-run | --apply]')
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const compiled = fs.existsSync(path.resolve('dist/src/index.js'))
  if (process.env.NODE_ENV === 'production' && !compiled) throw new Error('Compiled CMS application missing; deploy the build first')
  const context = compiled ? { appDir: process.cwd(), distDir: path.resolve('dist') } : await compileStrapi()
  const app = await createStrapi(context).load()
  try { console.log(JSON.stringify(await organizeMedia(app, { apply: args.includes('--apply') }))) }
  finally { await app.destroy() }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { buildPlan, organizeMedia, documentFolderName, uniqueDocumentFolders }
