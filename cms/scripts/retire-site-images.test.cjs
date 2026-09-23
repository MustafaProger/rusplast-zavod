const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { UID, retire, listDocuments, mediaSnapshot, linkedMediaCount } = require('./retire-site-images.cjs')

test('native retirement detaches both document versions, preserves files and rolls back an invariant failure', { timeout: 180000 }, async () => {
  const cms = path.resolve(__dirname, '..')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rpz-retirement-'))
  const previous = { ...process.env }
  Object.assign(process.env, {
    DATABASE_CLIENT: 'sqlite', DATABASE_FILENAME: '.tmp/test.db',
    STRAPI_TELEMETRY_DISABLED: 'true', STRAPI_DISABLE_UPDATE_NOTIFICATION: 'true',
    APP_KEYS: 'local-retire-key-1,local-retire-key-2', ADMIN_JWT_SECRET: 'local-retire-admin-key',
    API_TOKEN_SALT: 'local-retire-api-salt', TRANSFER_TOKEN_SALT: 'local-retire-transfer-salt', JWT_SECRET: 'local-retire-jwt-key',
  })
  let app
  try {
    fs.cpSync(path.join(cms, 'dist'), path.join(directory, 'dist'), { recursive: true, filter: source => source !== path.join(cms, 'dist', 'build') })
    fs.copyFileSync(path.join(cms, 'package.json'), path.join(directory, 'package.json'))
    fs.symlinkSync(path.join(cms, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
    fs.mkdirSync(path.join(directory, 'public', 'uploads'), { recursive: true })
    for (const name of ['site-image', 'retirement-control']) {
      const schemaDirectory = path.join(directory, 'dist', 'src', 'api', name, 'content-types', name)
      fs.mkdirSync(schemaDirectory, { recursive: true })
      fs.writeFileSync(path.join(schemaDirectory, 'schema.json'), JSON.stringify({
        kind: 'collectionType', collectionName: name.replaceAll('-', '_') + 's',
        info: { singularName: name, pluralName: name + 's', displayName: name }, options: { draftAndPublish: true },
        attributes: { title: { type: 'string' }, slug: { type: 'uid', targetField: 'title' }, image: { type: 'media', multiple: false, allowedTypes: ['images'] } },
      }))
    }
    const { createStrapi } = require('@strapi/strapi')
    app = await createStrapi({ appDir: directory, distDir: path.join(directory, 'dist') }).load()
    const files = []
    for (let index = 0; index < 8; index++) {
      files.push(await app.db.query('plugin::upload.file').create({ data: { name: `retirement-${index}.png`, hash: `retirement-${index}`, ext: '.png', mime: 'image/png', size: 1, url: `/uploads/retirement-${index}.png`, provider: 'local', folderPath: '/' } }))
    }
    for (let index = 0; index < 7; index++) {
      await app.documents(UID).create({ status: 'published', data: { title: `Site image ${index}`, slug: `site-image-${index}`, image: files[index].id } })
    }
    const controlUid = 'api::retirement-control.retirement-control'
    const control = await app.documents(controlUid).create({ status: 'published', data: { title: 'Keep me', slug: 'keep-me', image: files[0].id } })
    const before = await mediaSnapshot(app)
    const plan = await retire(app)
    assert.equal(plan.mode, 'dry-run')
    assert.equal(plan.documentCount, 7)
    assert.equal(plan.mediaLinks, 14)
    assert.equal((await listDocuments(app)).length, 7)
    assert.deepEqual(await mediaSnapshot(app), before)
    await assert.rejects(retire(app, { apply: true, expectedDocuments: 6 }), /Expected 6/)
    assert.equal((await listDocuments(app)).length, 7)

    // Simulate an unintended side effect of an installed lifecycle. All deletes
    // and the changed file must roll back when the snapshot guard fails.
    const unsubscribe = app.db.lifecycles.subscribe({ models: [UID], async afterDelete() {
      await app.db.query('plugin::upload.file').update({ where: { id: files[0].id }, data: { url: '/uploads/unexpected.png' } })
    } })
    await assert.rejects(retire(app, { apply: true }), /Uploaded file IDs, URLs or hashes changed/)
    unsubscribe()
    assert.equal((await listDocuments(app)).length, 7)
    assert.equal(await linkedMediaCount(app), 14)
    assert.deepEqual(await mediaSnapshot(app), before)

    const result = await retire(app, { apply: true })
    assert.equal(result.deletedDocuments, 7)
    assert.equal(result.deletedVersions, 14)
    assert.equal(result.mediaLinksAfter, 0)
    assert.equal(result.mediaPreserved, true)
    assert.deepEqual(await mediaSnapshot(app), before)
    assert.equal((await app.documents(controlUid).findOne({ documentId: control.documentId, status: 'published', populate: ['image'] })).image.id, files[0].id)
    const related = await app.db.query('plugin::upload.file').findOne({ where: { id: files[0].id }, populate: ['related'] })
    assert.ok(related.related.every(entry => entry.__type === controlUid), 'Other collection media relations remain usable')
    const repeat = await retire(app, { apply: true })
    assert.equal(repeat.deletedDocuments, 0)
    assert.equal(repeat.alreadyRetired, true)
    assert.deepEqual(await mediaSnapshot(app), before)
  } finally {
    if (app) await app.destroy()
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(previous, key)) delete process.env[key]
    Object.assign(process.env, previous)
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
