#!/usr/bin/env node
'use strict'

// Run from the target CMS directory AFTER importing content and BEFORE making
// /admin public. This copies bcrypt hashes directly, without resetting passwords.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')

async function main() {
  const adminFile = path.resolve(process.argv[2] || '')
  const manifestFile = path.resolve(process.argv[3] || '')
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: import-admins.cjs /private/admins.json /private/manifest.json')
  const contents = fs.readFileSync(adminFile)
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (manifest.version !== 1 || crypto.createHash('sha256').update(contents).digest('hex') !== manifest.adminsSha256) throw new Error('Admin export checksum mismatch.')
  const exported = JSON.parse(contents)
  if (exported.version !== 1 || !Array.isArray(exported.users) || !exported.users.length || exported.users.length !== manifest.adminUsers) throw new Error('Invalid admin export.')
  for (const user of exported.users) {
    if (typeof user.email !== 'string' || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(user.password || '') || user.roleCodes?.length !== 1 || user.roleCodes[0] !== 'strapi-super-admin') throw new Error('Unsupported admin export record.')
  }
  process.env.STRAPI_TELEMETRY_DISABLED = 'true'
  const cmsRequire = createRequire(path.resolve('package.json'))
  if (cmsRequire('@strapi/strapi/package.json').version !== manifest.strapiVersion) throw new Error('Source and destination Strapi versions differ.')
  const { compileStrapi, createStrapi } = cmsRequire('@strapi/strapi')
  const context = await compileStrapi()
  const app = createStrapi(context)
  app.log.level = 'error'
  try {
    await app.load()
    if (app.config.get('database.connection.client') !== 'postgres') throw new Error('This helper only targets the new PostgreSQL deployment.')
    const products = await app.db.query('api::product.product').count()
    const publishedProducts = await app.db.query('api::product.product').count({ where: { publishedAt: { $notNull: true } } })
    const leads = await app.db.query('api::lead.lead').count()
    const files = await app.db.query('plugin::upload.file').count()
    if (products !== manifest.productRows || publishedProducts !== manifest.publishedProducts || leads !== manifest.leads || files !== manifest.uploadFiles) throw new Error('Target content counts differ; import the verified content archive first.')
    await app.db.transaction(async () => {
      const query = app.db.query('admin::user')
      const current = await query.findMany({ populate: ['roles'] })
      if (current.length) {
        const matches = current.length === exported.users.length && exported.users.every(source => current.some(target => target.email === source.email && target.password === source.password && target.isActive === source.isActive && target.blocked === source.blocked && target.roles.length === 1 && target.roles[0].code === 'strapi-super-admin'))
        if (!matches) throw new Error('Target has a different admin account; refusing to overwrite it.')
        return
      }
      const role = await app.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
      if (!role) throw new Error('Target super-admin role is missing.')
      for (const source of exported.users) {
        const { roleCodes, ...data } = source
        await query.create({ data: { ...data, roles: [role.id], registrationToken: null, resetPasswordToken: null, resetPasswordTokenExpiresAt: null } })
      }
    })
    console.log(JSON.stringify({ products, publishedProducts, leads, files, admins: exported.users.length, adminPasswordsPreserved: true }))
  } finally { await app.destroy() }
}

// Driver exceptions can include SQL values. Keep errors generic unless ours.
main().catch(error => {
  const safe = ['Usage:', 'Admin export', 'Invalid admin', 'Unsupported admin', 'Source and destination', 'This helper', 'Target content', 'Target has', 'Target super-admin']
  console.error(safe.some(prefix => error.message?.startsWith(prefix)) ? error.message : 'Admin migration failed; credentials and customer fields were not logged.')
  process.exitCode = 1
})
