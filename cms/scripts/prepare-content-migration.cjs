#!/usr/bin/env node
// Prepare a portable, checksummed bundle. No CMS credentials or database needed.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' }

function prepare({ output, publicDir = path.resolve(__dirname, '../../web/public'), seedFile = path.resolve(__dirname, '../src/data/content-migration.json') }) {
  const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
  const manifest = { ...seed, assets: {} }
  fs.mkdirSync(path.join(output, 'assets'), { recursive: true })
  // This bundle contains only public website media. Normalize modes explicitly:
  // copyFileSync preserves a source PDF's 0600 mode, while Docker may retain a
  // different numeric owner than the non-root Strapi runtime user.
  fs.chmodSync(output, 0o755)
  fs.chmodSync(path.join(output, 'assets'), 0o755)
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name)
      if (entry.isDirectory()) { visit(source); continue }
      if (!entry.isFile()) continue
      const mime = MIME[path.extname(source).toLowerCase()]
      if (!mime) continue
      const content = fs.readFileSync(source)
      const sha256 = crypto.createHash('sha256').update(content).digest('hex')
      const originalName = path.basename(source)
      const filename = `${sha256.slice(0, 20)}-${originalName}`
      const relative = `/${path.relative(publicDir, source).split(path.sep).join('/')}`
      const destination = path.join(output, 'assets', filename)
      fs.copyFileSync(source, destination)
      fs.chmodSync(destination, 0o644)
      manifest.assets[relative] = { path: `assets/${filename}`, sha256, mime, size: content.length, originalName }
    }
  }
  visit(path.join(publicDir, 'images'))
  visit(path.join(publicDir, 'documents'))
  const references = [
    ...seed.products.map(item => item.image),
    ...seed.articles.map(item => item.image),
    ...seed.documents.flatMap(item => [item.file, ...item.pages]),
    ...(seed.siteImages || []).map(item => item.image),
  ]
  for (const reference of references) if (!manifest.assets[reference]) throw new Error(`Missing source asset: ${reference}`)
  fs.writeFileSync(path.join(output, 'content.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.chmodSync(path.join(output, 'content.json'), 0o644)
  return { products: seed.products.length, articles: seed.articles.length, documents: seed.documents.length, siteImages: seed.siteImages?.length || 0, assets: Object.keys(manifest.assets).length }
}

if (require.main === module) {
  const output = process.argv[2]
  if (!output) throw new Error('Usage: node cms/scripts/prepare-content-migration.cjs /absolute/output-directory')
  console.log(JSON.stringify(prepare({ output: path.resolve(output) })))
}
module.exports = { prepare }
