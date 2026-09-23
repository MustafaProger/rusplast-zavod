#!/usr/bin/env node
'use strict'

// Create a consistent SQLite backup and export only that backup. Output contains
// customer data and password hashes: keep the resulting directory private.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

process.umask(0o077)
const cmsDir = path.resolve(__dirname, '../../cms')
const cmsRequire = createRequire(path.join(cmsDir, 'package.json'))
const Database = cmsRequire('better-sqlite3')

async function main() {
  const source = path.resolve(process.argv[2] || path.join(cmsDir, '.tmp/data.db'))
  const out = path.resolve(process.argv[3] || path.join(cmsDir, '.tmp/transfer', new Date().toISOString().replace(/[:.]/g, '-')))
  if (fs.existsSync(out)) throw new Error('Output directory already exists; use a new directory.')
  fs.mkdirSync(out, { recursive: true, mode: 0o700 })
  const snapshot = path.join(out, 'source.db')
  const live = new Database(source, { readonly: true, fileMustExist: true })
  try { await live.backup(snapshot) } finally { live.close() }
  fs.chmodSync(snapshot, 0o600)

  const db = new Database(snapshot, { readonly: true })
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  const manifest = {
    version: 1,
    strapiVersion: cmsRequire('@strapi/strapi/package.json').version,
    productRows: count('products'),
    publishedProducts: db.prepare('SELECT COUNT(*) AS n FROM products WHERE published_at IS NOT NULL').get().n,
    leads: count('leads'),
    uploadFiles: count('files'),
    adminUsers: count('admin_users'),
  }
  const users = db.prepare('SELECT * FROM admin_users ORDER BY id').all().map(row => {
    const roles = db.prepare('SELECT r.code FROM admin_roles r JOIN admin_users_roles_lnk l ON l.role_id = r.id WHERE l.user_id = ? ORDER BY r.code').all(row.id).map(role => role.code)
    if (!/^\$2[aby]\$/.test(row.password || '')) throw new Error('Source contains an admin without a supported bcrypt hash.')
    if (roles.length !== 1 || roles[0] !== 'strapi-super-admin') throw new Error('Custom admin roles need a separate reviewed migration.')
    return {
      firstname: row.firstname, lastname: row.lastname, username: row.username,
      email: row.email, password: row.password, isActive: Boolean(row.is_active),
      blocked: Boolean(row.blocked), preferedLanguage: row.prefered_language,
      roleCodes: roles,
    }
  })
  db.close()
  if (!users.length) throw new Error('Source has no admin account; public admin registration must remain blocked.')
  const adminPath = path.join(out, 'admins.json')
  fs.writeFileSync(adminPath, JSON.stringify({ version: 1, users }, null, 2), { mode: 0o600 })

  const cli = path.join(path.dirname(cmsRequire.resolve('@strapi/strapi/package.json')), 'bin/strapi.js')
  const result = spawnSync(process.execPath, [cli, 'export', '--no-encrypt', '--file', path.join(out, 'content')], {
    cwd: cmsDir,
    env: { ...process.env, DATABASE_CLIENT: 'sqlite', DATABASE_FILENAME: path.relative(cmsDir, snapshot), STRAPI_TELEMETRY_DISABLED: 'true', STRAPI_DISABLE_UPDATE_NOTIFICATION: 'true' },
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  fs.writeFileSync(path.join(out, 'export.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 })
  if (result.status !== 0) throw new Error('Strapi export failed; details are in the private export.log.')
  const archive = path.join(out, 'content.tar.gz')
  fs.chmodSync(archive, 0o600)
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (listing.status !== 0) throw new Error('Cannot inspect export archive.')
  const counts = {}
  for (const entry of listing.stdout.trim().split('\n').filter(name => /^\.?\/?entities\/.*\.jsonl$/.test(name))) {
    const data = spawnSync('tar', ['-xOzf', archive, entry], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (data.status !== 0) throw new Error('Cannot read exported entities.')
    for (const line of data.stdout.split('\n').filter(Boolean)) {
      const entity = JSON.parse(line)
      counts[entity.type] = (counts[entity.type] || 0) + 1
      if (entity.type.startsWith('admin::')) throw new Error('Unexpected admin entity in content archive.')
    }
  }
  if (counts['api::product.product'] !== manifest.productRows || (counts['api::lead.lead'] || 0) !== manifest.leads || (counts['plugin::upload.file'] || 0) !== manifest.uploadFiles) throw new Error('Exported content counts differ from the source snapshot.')
  manifest.archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  manifest.adminsSha256 = crypto.createHash('sha256').update(fs.readFileSync(adminPath)).digest('hex')
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ directory: out, products: manifest.productRows, publishedProducts: manifest.publishedProducts, leads: manifest.leads, admins: users.length, archiveVerified: true }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
