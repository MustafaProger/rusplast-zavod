/** Shared Media Library helpers. Folder ids/paths are assigned by Strapi. */
const ROOT_FOLDERS = Object.freeze({ products: 'Товары', articles: 'Блог', documents: 'Документы', decor: 'Оформление сайта' })
const queues = new WeakMap()

function folderName(value) {
  // Strapi's admin rejects forward slashes in folder names.
  return String(value || '').replace(/[\\/\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 240)
}

async function ensureFolder(app, name, parent = null) {
  name = folderName(name)
  if (!name) throw new Error('Media folder name is required')
  const parentId = parent && typeof parent === 'object' ? parent.id : parent
  // Strapi allocates max(pathId)+1; serialize callers within this process.
  const previous = queues.get(app) || Promise.resolve()
  const pending = previous.catch(() => {}).then(async () => {
    const folders = app.db.query('plugin::upload.folder')
    const existing = await folders.findOne({ where: { name, parent: parentId || null } })
    if (existing) return existing
    if (parentId && !await folders.findOne({ where: { id: parentId } })) throw new Error(`Parent media folder ${parentId} does not exist`)
    return app.plugin('upload').service('folder').create({ name, parent: parentId || null })
  })
  queues.set(app, pending)
  try { return await pending }
  finally { if (queues.get(app) === pending) queues.delete(app) }
}

async function moveFileToFolder(app, file, folder, { name } = {}) {
  if (!file?.id || !folder?.id || !folder?.path) throw new Error('Existing file and target folder are required')
  // Use a fresh relation: upload results don't always populate `folder`.
  const current = await app.db.query('plugin::upload.file').findOne({ where: { id: file.id }, populate: ['folder'] })
  if (!current) throw new Error(`Media file ${file.id} no longer exists`)
  if (current.folder?.id === folder.id && current.folderPath === folder.path && (!name || current.name === name)) return current
  return app.plugin('upload').service('upload').updateFileInfo(current.id, { folder: folder.id, ...(name ? { name } : {}) })
}

module.exports = { ROOT_FOLDERS, folderName, ensureFolder, moveFileToFolder }
