// Build cms and web first. CMS_TEST_ARTICLE/CMS_TEST_COVER may select already
// prepared real content. This test never generates content, publishes to
// production or changes the supplied JSON/PNG.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { createServer } = require('node:net')
const { spawn } = require('node:child_process')
const sharp = require('sharp')
const { publish, normalize, digest } = require('../scripts/publish-article.cjs')

const UID = 'api::article.article'
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const escapeHtml = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[character])

function coverDifference(source, downloaded) {
  assert.equal(downloaded.length, source.length)
  const histogram = new Uint32Array(256)
  let absoluteError = 0, squaredError = 0, alphaMax = 0, max = 0
  for (let index = 0; index < source.length; index++) {
    const error = Math.abs(downloaded[index] - source[index])
    if (index % 4 === 3) { alphaMax = Math.max(alphaMax, error); continue }
    histogram[error]++
    absoluteError += error
    squaredError += error * error
    max = Math.max(max, error)
  }
  const channels = source.length / 4 * 3
  let p95 = 0, cumulative = 0
  while (p95 < 255 && cumulative + histogram[p95] < channels * 0.95) cumulative += histogram[p95++]
  return { mean: absoluteError / channels, rms: Math.sqrt(squaredError / channels), p95, max, alphaMax }
}

async function startWebsite(cmsDirectory, cmsOrigin) {
  const webDirectory = path.resolve(cmsDirectory, '../web')
  assert.ok(fs.existsSync(path.join(webDirectory, 'dist/shell.html')) && fs.existsSync(path.join(webDirectory, 'dist-server/entry-static.js')), 'Build web before running its native CMS integration')
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(process.execPath, ['scripts/server.mjs'], {
    cwd: webDirectory,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CMS_INTERNAL_URL: cmsOrigin, CMS_URL: cmsOrigin, CMS_PUBLIC_URL: 'https://cms.rusplast-zavod.ru', CONTENT_CACHE_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    await new Promise(resolve => {
      child.once('exit', () => { clearTimeout(timeout); resolve() })
      const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
      child.kill('SIGTERM')
    })
  }
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Website did not start: ${output}`)), 15000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Website exited (${code}): ${output}`)) })
      child.stdout.on('data', chunk => {
        output = (output + chunk).slice(-8000)
        if (output.includes('CMS website server ready')) { clearTimeout(timeout); resolve() }
      })
      child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000) })
    })
  } catch (error) { await stop(); throw error }
  return { origin: `http://127.0.0.1:${port}`, stop }
}

test('native Strapi publication: real PNG, folder, public API and protected retries', { timeout: 180000 }, async t => {
  const cms = path.resolve(__dirname, '..')
  const sourceImage = process.env.CMS_TEST_COVER || path.resolve(cms, '../web/public/images/hero-pipes.png')
  const sourceArticle = process.env.CMS_TEST_ARTICLE
  const sourceArticleBytes = sourceArticle ? fs.readFileSync(sourceArticle) : null
  const sourceBytes = fs.readFileSync(sourceImage)
  const imageSha256 = sha256(sourceBytes)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rpz-article-publication-'))
  const imagePath = path.join(directory, 'cover.png')
  fs.writeFileSync(imagePath, sourceBytes)
  const previous = { ...process.env }
  Object.assign(process.env, {
    DATABASE_CLIENT: 'sqlite', DATABASE_FILENAME: '.tmp/test.db',
    STRAPI_TELEMETRY_DISABLED: 'true',
    APP_KEYS: 'local-publication-key-1,local-publication-key-2', ADMIN_JWT_SECRET: 'local-publication-admin-key',
    API_TOKEN_SALT: 'local-publication-api-salt', TRANSFER_TOKEN_SALT: 'local-publication-transfer-salt', JWT_SECRET: 'local-publication-jwt-key',
  })
  const article = sourceArticleBytes ? JSON.parse(sourceArticleBytes.toString('utf8')) : {
    slug: 'native-publication-fixture', title: 'Как подготовить перечень гофротрубы для заявки',
    seoTitle: 'Перечень гофротрубы для заявки — проверка публикации',
    description: 'Редакционный материал для проверки передачи текста и обложки через CMS.',
    category: 'Закупки', image: 'generated-cover', imageAlt: 'Предметная иллюстрация гофрированных труб',
    intro: 'В заявке удобно перечислить позиции отдельными строками, чтобы согласовать состав заказа.',
    takeaway: 'Сверьте названия позиций с опубликованным каталогом и уточните детали у отдела продаж.',
    sections: [{ id: 'list', title: 'Составьте перечень', paragraphs: ['Укажите требуемые позиции и количество для каждой строки.'], list: ['Название позиции', 'Количество'], links: [{ label: 'Каталог продукции', href: '/catalog' }] }],
    sources: [{ label: 'Каталог РУСПЛАСТЗАВОДА', href: 'https://rusplast-zavod.ru/catalog' }],
    related: [], author: 'Редакция РУСПЛАСТЗАВОДА', publishedAt: '2026-09-23',
  }
  const bundleFor = (slug = article.slug) => {
    const value = { ...structuredClone(article), slug }
    return { article: value, imageSha256, inputSha256: digest({ article: value, imageSha256 }), imageGeneration: { testFixture: true } }
  }
  const draftData = (bundle, imageId) => {
    const { image, publishedAt, ...data } = bundle.article
    return { ...data, image: imageId, publishedOn: publishedAt, publicationInputSha256: bundle.inputSha256 }
  }
  let app
  let website
  let imageDifference
  try {
    fs.cpSync(path.join(cms, 'dist'), path.join(directory, 'dist'), { recursive: true, filter: source => source !== path.join(cms, 'dist', 'build') })
    fs.copyFileSync(path.join(cms, 'package.json'), path.join(directory, 'package.json'))
    fs.symlinkSync(path.join(cms, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
    fs.mkdirSync(path.join(directory, 'public', 'uploads'), { recursive: true })
    const { createStrapi } = require('@strapi/strapi')
    app = await createStrapi({ appDir: directory, distDir: path.join(directory, 'dist') }).load()
    assert.equal(path.resolve(app.dirs.static.public), path.join(directory, 'public'), 'Uploads are isolated from developer files')
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${app.server.httpServer.address().port}`
    website = await startWebsite(cms, origin)
    const siteText = async (pathname, status = 200) => {
      const response = await fetch(website.origin + pathname)
      const text = await response.text()
      assert.equal(response.status, status, `${pathname}: ${text.slice(0, 300)}`)
      return text
    }
    assert.equal((await fetch(`${website.origin}/blog/${article.slug}`)).status, 404, 'Website starts before publication and does not serve a future article')
    const publicArticle = async (slug, status = 'published') => {
      const query = new URLSearchParams({ 'filters[slug][$eq]': slug, 'populate[0]': 'image', status })
      const response = await fetch(`${origin}/api/articles?${query}`)
      assert.equal(response.status, 200)
      return (await response.json()).data
    }
    const counts = async () => ({
      files: await app.db.query('plugin::upload.file').count(),
      folders: await app.db.query('plugin::upload.folder').count(),
      articles: await app.db.query(UID).count(),
    })
    let publishCalls = 0
    let interruptSlug = null
    const observedDrafts = []
    // Native Document Service middleware observes the actual persisted draft;
    // it only injects a failure in the explicit interrupted-publication case.
    app.documents.use(async (context, next) => {
      if (context.uid === UID && context.action === 'publish') {
        publishCalls++
        const draft = await app.documents(UID).findOne({ documentId: context.params.documentId, status: 'draft', populate: ['image'] })
        assert.ok(draft.image?.id, 'The cover is attached before publishing')
        assert.equal(draft.publishedAt, null)
        assert.deepEqual(await publicArticle(draft.slug), [], 'The draft is not publicly visible before publication')
        observedDrafts.push(structuredClone(draft))
        if (draft.slug === interruptSlug) throw new Error('Integration fixture: interrupted before native publish')
      }
      return next()
    })
    const bundle = bundleFor()
    let first
    let folder

    await t.test('uploads the actual PNG directly into Блог, attaches draft and publishes the same text and image', async () => {
      first = await publish(app, bundle, imagePath)
      assert.equal(observedDrafts.length, 1)
      assert.equal(publishCalls, 1)
      assert.deepEqual(normalize(observedDrafts[0]), first.article)
      assert.equal(first.sha256, digest(first.article))
      assert.equal(first.inputSha256, bundle.inputSha256)
      folder = await app.db.query('plugin::upload.folder').findOne({ where: { name: 'Блог', parent: null } })
      assert.ok(folder?.id)
      const media = await app.db.query('plugin::upload.file').findOne({ where: { id: first.imageId }, populate: ['folder'] })
      assert.equal(media.folder.id, folder.id)
      assert.equal(media.folderPath, folder.path)
      assert.equal(media.mime, 'image/png')
      assert.equal(media.alternativeText, bundle.article.imageAlt)
      assert.ok(media.width >= 1400 && media.height >= 800)
      const imageResponse = await fetch(`${origin}${media.url}`)
      assert.equal(imageResponse.status, 200)
      assert.match(imageResponse.headers.get('content-type'), /^image\/png/)
      const downloadedImage = Buffer.from(await imageResponse.arrayBuffer())
      const imageMetadata = await sharp(downloadedImage).metadata()
      assert.equal(imageMetadata.width, media.width)
      assert.equal(imageMetadata.height, media.height)
      const [sourcePixels, downloadedPixels] = await Promise.all([
        sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(downloadedImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ])
      assert.deepEqual(downloadedPixels.info, sourcePixels.info, 'Decoded cover geometry and channels are unchanged')
      imageDifference = coverDifference(sourcePixels.data, downloadedPixels.data)
      // Strapi's existing default optimization quantizes PNG at quality 80.
      // A small bounded RGB difference is expected; another cover is rejected.
      console.log(JSON.stringify({ coverRgbDifference: imageDifference, sourceImageSha256: imageSha256 }))
      assert.equal(imageDifference.alphaMax, 0, 'Original cover transparency is preserved')
      assert.ok(imageDifference.mean <= 4 && imageDifference.p95 <= 12, `CMS cover differs beyond expected PNG quantization: ${JSON.stringify(imageDifference)}`)
      const [visible] = await publicArticle(bundle.article.slug)
      assert.deepEqual(normalize(visible), first.article)
      assert.equal(visible.image.id, first.imageId)
      assert.ok(!Object.hasOwn(visible, 'publicationInputSha256'))
      assert.ok(!Object.hasOwn(visible, 'imageGeneration'))
      assert.deepEqual(await counts(), { files: 1, folders: 1, articles: 2 })
    })

    await t.test('retries without duplicate files, articles, folders or publication', async () => {
      const before = await counts()
      assert.deepEqual(await publish(app, bundle, imagePath), first)
      assert.deepEqual(await counts(), before)
      assert.equal(publishCalls, 1)
    })

    await t.test('the running website renders the new article and blog cover with matching manifest and sitemap', async () => {
      const html = await siteText(`/blog/${article.slug}`)
      assert.ok(html.includes(`<h1>${escapeHtml(first.article.title)}</h1>`))
      assert.ok(html.includes(`<p class="article-intro">${escapeHtml(first.article.intro)}</p>`))
      const paragraph = first.article.sections.flatMap(section => section.paragraphs).find(Boolean)
      assert.ok(paragraph, 'Prepared article contains readable paragraph text')
      assert.ok(html.includes(`<p>${escapeHtml(paragraph)}</p>`))
      const figure = html.match(/<figure class="article-cover">([\s\S]*?)<\/figure>/)?.[1]
      assert.ok(figure, 'The actual article cover element is present')
      assert.equal(figure.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1], first.article.image)
      assert.ok(figure.includes(`alt="${escapeHtml(first.article.imageAlt)}"`))
      const blog = await siteText('/blog')
      const card = [...blog.matchAll(/<article class="article-card">[\s\S]*?<\/article>/g)].map(match => match[0]).find(value => value.includes(`href="/blog/${article.slug}"`))
      assert.ok(card, 'The newly published article has a blog card')
      assert.equal(card.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1], first.article.image)
      assert.ok(card.includes(escapeHtml(first.article.title)))
      const manifest = JSON.parse(await siteText('/publication-manifest.json'))
      assert.deepEqual(manifest.articles[article.slug], { sha256: first.sha256, publishedAt: first.article.publishedAt })
      assert.ok((await siteText('/sitemap.xml')).includes(`<loc>${first.url}</loc>`))
    })

    await t.test('a saved editor draft stays private and is never published by retry', async () => {
      await app.documents(UID).update({ documentId: first.documentId, data: { title: 'Ручной черновик редактора', intro: 'Изменения ещё не утверждены.' } })
      assert.deepEqual(await publish(app, bundle, imagePath), first)
      assert.equal(publishCalls, 1)
      const draft = await app.documents(UID).findOne({ documentId: first.documentId, status: 'draft' })
      assert.equal(draft.title, 'Ручной черновик редактора')
      const [visible] = await publicArticle(bundle.article.slug, 'draft')
      assert.deepEqual(normalize(visible), first.article, 'Public status=draft cannot expose editor changes')
      const html = await siteText(`/blog/${article.slug}`)
      assert.ok(html.includes(`<h1>${escapeHtml(first.article.title)}</h1>`))
      assert.ok(!html.includes('Ручной черновик редактора'))
      assert.equal(JSON.parse(await siteText('/publication-manifest.json')).articles[article.slug].sha256, first.sha256)
    })

    await t.test('a missing cover fails before any CMS write or publication', async () => {
      const before = await counts()
      const next = bundleFor('missing-cover-fixture')
      await assert.rejects(publish(app, next, path.join(directory, 'does-not-exist.png')), { code: 'ENOENT' })
      assert.deepEqual(await counts(), before)
      assert.equal(publishCalls, 1)
      assert.deepEqual(await publicArticle(next.article.slug), [])
      await siteText(`/blog/${next.article.slug}`, 404)
    })

    await t.test('resumes an interrupted matching draft with the same uploaded file', async () => {
      const next = bundleFor('interrupted-publication-fixture')
      interruptSlug = next.article.slug
      await assert.rejects(publish(app, next, imagePath), /interrupted before native publish/)
      const draft = await app.documents(UID).findFirst({ filters: { slug: next.article.slug }, status: 'draft', populate: ['image'] })
      assert.ok(draft.image.id)
      const before = await counts()
      assert.deepEqual(await publicArticle(next.article.slug, 'draft'), [])
      await siteText(`/blog/${next.article.slug}`, 404)
      interruptSlug = null
      const resumed = await publish(app, next, imagePath)
      assert.equal(resumed.documentId, draft.documentId)
      assert.equal(resumed.imageId, draft.image.id)
      assert.equal((await counts()).files, before.files)
      assert.equal((await counts()).folders, before.folders)
      assert.equal((await counts()).articles, before.articles + 1)
      assert.deepEqual(normalize((await publicArticle(next.article.slug))[0]), resumed.article)
      assert.ok((await siteText(`/blog/${next.article.slug}`)).includes(`src="${resumed.article.image}"`))
      assert.equal(JSON.parse(await siteText('/publication-manifest.json')).articles[next.article.slug].sha256, resumed.sha256)
    })

    await t.test('rejects a pending draft that a person edited without overwriting or publishing it', async () => {
      const next = bundleFor('manual-pending-draft-fixture')
      const manual = await app.documents(UID).create({ status: 'draft', data: { ...draftData(next, first.imageId), title: 'Ручное изменение подготовленного черновика' } })
      const before = await counts()
      const callsBefore = publishCalls
      await assert.rejects(publish(app, next, imagePath), /preserve manual edit/)
      assert.deepEqual(await counts(), before)
      assert.equal(publishCalls, callsBefore)
      assert.equal((await app.documents(UID).findOne({ documentId: manual.documentId, status: 'draft' })).title, 'Ручное изменение подготовленного черновика')
      assert.deepEqual(await publicArticle(next.article.slug, 'draft'), [])
    })

    await t.test('repairs only the old own root cover and preserves a folder chosen by an editor', async () => {
      await app.plugin('upload').service('upload').updateFileInfo(first.imageId, { folder: null })
      assert.deepEqual(await publish(app, bundle, imagePath), first)
      let media = await app.db.query('plugin::upload.file').findOne({ where: { id: first.imageId }, populate: ['folder'] })
      assert.equal(media.folder.id, folder.id)
      const editorFolder = await app.plugin('upload').service('folder').create({ name: 'Выбор редактора', parent: null })
      await app.plugin('upload').service('upload').updateFileInfo(first.imageId, { folder: editorFolder.id })
      assert.deepEqual(await publish(app, bundle, imagePath), first)
      media = await app.db.query('plugin::upload.file').findOne({ where: { id: first.imageId }, populate: ['folder'] })
      assert.equal(media.folder.id, editorFolder.id)
      assert.equal(media.folderPath, editorFolder.path)
    })

    assert.equal(sha256(fs.readFileSync(sourceImage)), imageSha256, 'Original generated PNG is unchanged')
    if (sourceArticle) assert.deepEqual(fs.readFileSync(sourceArticle), sourceArticleBytes, 'Original prepared JSON is unchanged')
    console.log(JSON.stringify({ nativeArticlePublication: 'fixture-summary', sourceArticle, sourceImage, imageSha256, imageDifference, ...await counts(), observedDrafts: observedDrafts.length, publishCalls }))
  } finally {
    if (website) await website.stop()
    if (app) await app.destroy()
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(previous, key)) delete process.env[key]
    Object.assign(process.env, previous)
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
