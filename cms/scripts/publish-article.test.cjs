const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const sharp = require('sharp')
const { publish, digest } = require('./publish-article.cjs')

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-publish-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const imagePath = path.join(directory, 'cover.png')
  const bytes = await sharp(crypto.randomBytes(1536 * 1024 * 3), { raw: { width: 1536, height: 1024, channels: 3 } }).png().toBuffer()
  await fs.writeFile(imagePath, bytes)
  const article = { slug: 'test-editorial', title: 'Test article', seoTitle: 'Test SEO title', description: 'Description', category: 'Guide', image: 'generated-cover', imageAlt: 'Grey conduit', intro: 'Intro', takeaway: 'Takeaway', sections: [], sources: [], related: [], author: 'Редакция РУСПЛАСТЗАВОДА', publishedAt: '2026-09-23' }
  const imageSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const bundle = { article, imageSha256, inputSha256: digest({ article, imageSha256 }), imageGeneration: {} }
  const state = { draft: null, published: null, creates: 0, uploads: 0, publishes: 0, folderCreates: 0, mediaUpdates: 0, folders: [], files: [] }
  const media = { id: 1, name: `${article.slug}-${imageSha256.slice(0, 16)}.png`, url: '/uploads/test_cover.png', width: 1536, height: 1024, folder: null, folderPath: '/' }
  const documents = {
    findFirst: async ({ status }) => structuredClone(state[status]),
    findOne: async ({ status }) => structuredClone(state[status]),
    create: async ({ data }) => {
      state.creates++
      state.draft = { ...data, documentId: 'doc-1', image: media }
      return structuredClone(state.draft)
    },
    publish: async () => { state.publishes++; state.published = structuredClone(state.draft) },
  }
  const app = {
    documents: () => documents,
    db: { query: uid => {
      if (uid === 'plugin::upload.file') return {
        findOne: async ({ where }) => structuredClone(state.files.find(file => Object.entries(where).every(([key, value]) => file[key] === value)) ?? null),
      }
      assert.equal(uid, 'plugin::upload.folder')
      return {
        findOne: async ({ where }) => structuredClone(state.folders.find(folder => folder.name === where.name && folder.parent === (where.parent ?? null)) ?? null),
      }
    } },
    plugin: name => {
      assert.equal(name, 'upload')
      return { service: service => {
        if (service === 'folder') return { create: async ({ name, parent }) => {
          state.folderCreates++
          const folder = { id: 10 + state.folderCreates, name, parent: parent ?? null, path: `/${10 + state.folderCreates}` }
          state.folders.push(folder)
          return structuredClone(folder)
        } }
        assert.equal(service, 'upload')
        return {
          upload: async ({ data: { fileInfo } }) => {
            state.uploads++
            const folder = state.folders.find(folder => folder.id === fileInfo.folder)
            assert.ok(folder, 'native upload receives fileInfo.folder')
            assert.equal(folder.name, 'Блог')
            Object.assign(media, fileInfo, { folder: structuredClone(folder), folderPath: folder.path })
            state.files.push(media)
            return [structuredClone(media)]
          },
          updateFileInfo: async (id, data) => {
            state.mediaUpdates++
            const file = state.files.find(file => file.id === id)
            const folder = state.folders.find(folder => folder.id === data.folder)
            assert.ok(file)
            assert.ok(folder, 'native upload.updateFileInfo receives folder ID')
            Object.assign(file, data, { folder: structuredClone(folder), folderPath: folder.path })
            return structuredClone(file)
          },
        }
      } }
    },
  }
  return { app, bundle, state, imagePath, media }
}

test('uploads cover, saves CMS draft, publishes once, retries without writes', async t => {
  const { app, bundle, state, imagePath } = await fixture(t)
  const first = await publish(app, bundle, imagePath)
  assert.equal(first.article.image, 'https://cms.rusplast-zavod.ru/uploads/test_cover.png')
  assert.equal(first.inputSha256, bundle.inputSha256)
  assert.equal(first.sha256, digest(first.article))
  assert.deepEqual(await publish(app, bundle, imagePath), first)
  assert.equal(state.creates, 1); assert.equal(state.uploads, 1); assert.equal(state.publishes, 1)
  assert.equal(state.folderCreates, 1); assert.equal(state.mediaUpdates, 0)
  assert.equal(state.files[0].folder.name, 'Блог')
  assert.equal(state.files[0].folderPath, state.folders[0].path)
})

test('published retry preserves newer unpublished editor draft', async t => {
  const { app, bundle, state, imagePath } = await fixture(t)
  const first = await publish(app, bundle, imagePath)
  state.draft.title = 'Editor draft awaiting approval'
  assert.deepEqual(await publish(app, bundle, imagePath), first)
  assert.equal(state.draft.title, 'Editor draft awaiting approval')
  assert.equal(state.publishes, 1)
})

test('manually changed pending draft is never overwritten or published', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  state.draft = { ...bundle.article, title: 'Manual edit', publishedOn: bundle.article.publishedAt, image: media, documentId: 'draft-1', publicationInputSha256: bundle.inputSha256 }
  await assert.rejects(publish(app, bundle, imagePath), /preserve manual edit/)
  assert.equal(state.publishes, 0); assert.equal(state.uploads, 0); assert.equal(state.creates, 0)
})

test('pre-existing unrelated draft is preserved', async t => {
  const { app, bundle, state, imagePath } = await fixture(t)
  state.draft = { ...bundle.article, documentId: 'manual' }
  await assert.rejects(publish(app, bundle, imagePath), /manual draft preserved/)
  assert.equal(state.publishes, 0); assert.equal(state.uploads, 0)
})

test('manual published edits cannot be reverted by an old retry', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  await publish(app, bundle, imagePath)
  Object.assign(media, { folder: null, folderPath: '/' })
  state.published.intro = 'A human updated this published article'
  await assert.rejects(publish(app, bundle, imagePath), /preserve manual edit/)
  assert.equal(state.publishes, 1)
  assert.equal(state.mediaUpdates, 0)
})

test('reuses the existing root Блог folder for a new cover', async t => {
  const { app, bundle, state, imagePath } = await fixture(t)
  state.folders.push({ id: 42, name: 'Блог', parent: null, path: '/42' })
  await publish(app, bundle, imagePath)
  assert.equal(state.folderCreates, 0)
  assert.equal(state.files[0].folder.id, 42)
})

test('moves own root upload from an interrupted run without uploading again', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  state.files.push(media)
  await publish(app, bundle, imagePath)
  assert.equal(state.uploads, 0)
  assert.equal(state.mediaUpdates, 1)
  assert.equal(media.folder.name, 'Блог')
  assert.equal(media.url, '/uploads/test_cover.png')
})

test('published retry sorts its old root cover without republishing', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  const first = await publish(app, bundle, imagePath)
  Object.assign(media, { folder: null, folderPath: '/' })
  assert.deepEqual(await publish(app, bundle, imagePath), first)
  assert.equal(state.mediaUpdates, 1)
  assert.equal(state.uploads, 1)
  assert.equal(state.publishes, 1)
  assert.equal(media.folder.name, 'Блог')
})

test('matching pending draft sorts its old root cover before resuming publication', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  await publish(app, bundle, imagePath)
  state.published = null
  Object.assign(media, { folder: null, folderPath: '/' })
  await publish(app, bundle, imagePath)
  assert.equal(state.mediaUpdates, 1)
  assert.equal(state.uploads, 1)
  assert.equal(state.creates, 1)
  assert.equal(state.publishes, 2)
  assert.equal(media.folder.name, 'Блог')
})

test('retry preserves a folder chosen by an editor', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  const first = await publish(app, bundle, imagePath)
  Object.assign(media, { folder: { id: 99, name: 'Выбор редактора', path: '/99' }, folderPath: '/99' })
  assert.deepEqual(await publish(app, bundle, imagePath), first)
  assert.equal(state.mediaUpdates, 0)
  assert.equal(media.folder.id, 99)
})

test('retry preserves an editor-renamed root file', async t => {
  const { app, bundle, state, imagePath, media } = await fixture(t)
  const first = await publish(app, bundle, imagePath)
  Object.assign(media, { name: 'Выбор редактора.png', folder: null, folderPath: '/' })
  assert.deepEqual(await publish(app, bundle, imagePath), first)
  assert.equal(state.mediaUpdates, 0)
  assert.equal(media.folder, null)
})

test('changed cover fails before any CMS write', async t => {
  const { app, bundle, state, imagePath } = await fixture(t)
  bundle.imageSha256 = '0'.repeat(64)
  bundle.inputSha256 = digest({ article: bundle.article, imageSha256: bundle.imageSha256 })
  await assert.rejects(publish(app, bundle, imagePath), /Cover bytes or digest invalid/)
  assert.equal(state.creates, 0); assert.equal(state.uploads, 0); assert.equal(state.publishes, 0)
})
