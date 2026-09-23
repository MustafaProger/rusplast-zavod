import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const seed = JSON.parse(await readFile('../cms/src/data/content-migration.json', 'utf8'))
const article = { ...seed.articles[0], slug: 'cms-live-article', title: 'Статья из CMS', publishedOn: '2026-09-23', image: { url: '/uploads/article.webp' } }
const draft = { ...article, slug: 'cms-draft-only', title: 'Непубличный черновик', publishedAt: null }
const publicCms = 'https://cms.rusplast-zavod.ru'
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const normalized = entry => ({
  ...Object.fromEntries(['slug', 'title', 'seoTitle', 'description', 'category', 'imageAlt', 'intro', 'takeaway', 'sections', 'sources', 'related'].map(key => [key, entry[key]])),
  image: new URL(entry.image.url, publicCms).href,
  author: entry.author || 'Редакция РУСПЛАСТЗАВОДА', publishedAt: entry.publishedOn,
  ...(entry.modifiedOn ? { modifiedAt: entry.modifiedOn } : {}),
})
const cacheMs = 500
const refresh = () => new Promise(resolve => setTimeout(resolve, cacheMs + 150))
let entries = [article], unavailable = false
const cmsRequests = []
const cms = createServer((req, res) => {
  if (unavailable) { res.writeHead(503); return res.end('{}') }
  const request = new URL(req.url, 'http://localhost')
  const route = request.pathname
  cmsRequests.push({ path: route, status: request.searchParams.get('status') })
  if (route === '/api/site-images') { res.writeHead(404); return res.end('{}') }
  // Expose a draft if the website forgets its published-only query, so the
  // page/manifest assertions catch that regression independently of Strapi.
  const data = route === '/api/articles' ? request.searchParams.get('status') === 'published' ? entries : [...entries, draft] : route === '/api/products' ? seed.products.map(product => ({ ...product, photo: { url: `/uploads/${product.sku}.webp` } })) : route === '/api/documents' ? [{ slug: 'pdf-only', title: 'Новый документ PDF', subtitle: 'Без отдельного скана', sortOrder: 1, file: { url: '/uploads/new.pdf' }, pages: [] }] : []
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data, meta: { pagination: { pageCount: 1 } } }))
}).listen(0, '127.0.0.1')
await once(cms, 'listening')
const cmsUrl = `http://127.0.0.1:${cms.address().port}`
const reservation = createServer().listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['scripts/server.mjs'], { env: { ...process.env, PORT: String(port), CMS_INTERNAL_URL: cmsUrl, CMS_PUBLIC_URL: publicCms, CONTENT_CACHE_MS: String(cacheMs) }, stdio: 'pipe' })
let serverOutput = ''
server.stdout.on('data', output => { serverOutput += output })
server.stderr.on('data', output => { serverOutput += output })
let browser
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base + '/healthz').then(r => r.ok).catch(() => false)) break; await new Promise(r => setTimeout(r, 100)) }
  let response = await fetch(base + '/blog/cms-live-article')
  assert.equal(response.status, 200)
  let html = await response.text()
  assert(html.includes('<h1>Статья из CMS</h1>'))
  assert(html.includes('https://cms.rusplast-zavod.ru/uploads/article.webp'))
  assert(html.includes('window.__RPZ_CONTENT__='))
  assert((await fetch(base + '/catalog').then(r => r.text())).includes(`src="https://cms.rusplast-zavod.ru/uploads/${seed.products[0].sku}.webp"`))
  assert((await fetch(base + '/sitemap.xml').then(r => r.text())).includes('/blog/cms-live-article'))
  const before = await fetch(base + '/publication-manifest.json').then(r => r.json())
  assert.equal(before.articles[article.slug].sha256, hash(normalized(article)), 'Manifest hashes the exact CMS text and assigned image URL')
  assert.equal(before.articles[draft.slug], undefined)
  const revised = { ...article, title: 'Изменено редактором CMS', seoTitle: 'Обновлённый SEO заголовок статьи', intro: 'Обновлённый вводный текст из CMS', image: { url: '/uploads/revised-cover.png' } }
  entries = [revised]
  const cached = await fetch(base + '/publication-manifest.json').then(r => r.json())
  assert.equal(cached.articles[article.slug].sha256, before.articles[article.slug].sha256, 'Content stays consistent within the cache TTL')
  await refresh()
  assert((await fetch(base + '/blog/cms-live-article').then(r => r.text())).includes('<h1>Изменено редактором CMS</h1>'))
  const after = await fetch(base + '/publication-manifest.json').then(r => r.json())
  assert.equal(after.articles[article.slug].sha256, hash(normalized(revised)), 'Editor changes appear after cache expiry without a rebuild')
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Rendering checks use deterministic local image bytes; image-generation
  // quality and the real CMS file are verified by the publication integration.
  await page.route(`${publicCms}/uploads/**`, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1kAAAAASUVORK5CYII=', 'base64') }))
  await page.route('**/api/products?**', route => route.fulfill({ json: { data: seed.products, meta: { pagination: { pageCount: 1 } } } }))
  const cover = normalized(revised).image
  await page.goto(base + '/blog', { waitUntil: 'networkidle' })
  const card = page.locator('.article-card').filter({ has: page.locator(`a[href="/blog/${revised.slug}"]`) })
  assert.equal(await card.count(), 1)
  assert.equal(await card.locator('h2').innerText(), revised.title)
  assert.equal(await card.locator('img').getAttribute('src'), cover, 'Listing displays this article’s assigned CMS image')
  assert.equal(await page.getByText(draft.title, { exact: true }).count(), 0)
  await page.goto(base + '/blog/' + revised.slug, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('h1').innerText(), revised.title)
  assert.equal(await page.locator('.article-intro').innerText(), revised.intro)
  assert.equal(await page.locator('.article-cover img').getAttribute('src'), cover)
  assert.equal(await page.locator('.article-cover img').getAttribute('alt'), revised.imageAlt)
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), cover)
  assert.equal(await page.locator('meta[name="twitter:image"]').getAttribute('content'), cover)
  const posting = JSON.parse(await page.locator('#page-schema').textContent())['@graph'].find(item => item['@type'] === 'BlogPosting')
  assert.equal(posting.image, cover)
  assert.equal(posting.headline, revised.title)
  assert.equal(posting.datePublished, revised.publishedOn)
  assert.equal(await page.title(), revised.seoTitle + ' | РУСПЛАСТЗАВОД')
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://rusplast-zavod.ru/blog/' + revised.slug)
  const renderedBody = await page.locator('.article-body').innerText()
  for (const section of revised.sections) {
    for (const text of [section.title, ...section.paragraphs, ...(section.list || []), ...(section.table?.rows.flat() || [])]) assert(renderedBody.includes(text), 'The rendered article retains every CMS section')
  }
  for (const source of revised.sources) assert.equal(await page.locator('.article-sources a').filter({ hasText: source.label }).getAttribute('href'), source.href)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  assert.equal(await page.locator('.blog-preview .article-card img').getAttribute('src'), cover)
  assert.equal(await page.locator('.blog-preview .article-card h2').innerText(), revised.title)
  await page.getByRole('button', { name: 'Открыть документ: Новый документ PDF' }).click()
  assert.equal(await page.locator('.document-pdf object').getAttribute('data'), '/documents/pdf-only.pdf')
  assert.equal(await page.getByRole('link', { name: 'Открыть PDF' }).getAttribute('href'), '/documents/pdf-only.pdf')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  await page.route('**/api/products?**', route => route.abort())
  await page.goto(base + '/catalog', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(150)
  assert((await page.locator('.product-image img').first().getAttribute('src')).startsWith('https://cms.rusplast-zavod.ru/uploads/'), 'Failed browser refetch keeps fresh SSR products')
  assert.equal((await fetch(base + '/blog/' + draft.slug)).status, 404)
  assert(!((await fetch(base + '/sitemap.xml').then(r => r.text())).includes(draft.slug)))
  const routes = await fetch(base + '/route-manifest.json').then(r => r.json())
  assert(routes.indexable.includes('/blog/' + revised.slug))
  assert(!routes.indexable.includes('/blog/' + draft.slug))
  assert(cmsRequests.filter(request => request.path === '/api/articles').every(request => request.status === 'published'))
  assert.equal((await fetch(base + '/api/articles')).status, 200)
  assert.equal((await fetch(base + '/api/leads')).status, 404)
  assert.equal((await fetch(base + '/api/site-images')).status, 404)
  assert(!cmsRequests.some(request => request.path === '/api/site-images'), 'Removed collection is never queried')
  entries = []
  await refresh()
  assert.equal((await fetch(base + '/blog/cms-live-article')).status, 404)
  assert(!(await fetch(base + '/sitemap.xml').then(r => r.text())).includes('/blog/cms-live-article'))
  assert.equal((await fetch(base + '/publication-manifest.json').then(r => r.json())).articles[article.slug], undefined)
  assert.equal((await fetch(base + '/blog/does-not-exist')).status, 404)
  unavailable = true
  await refresh()
  assert.equal((await fetch(base + '/blog')).status, 503)
  assert.equal((await fetch(base + '/shell.html')).status, 503)
  assert.deepEqual(errors, [])
  console.log('PASS: CMS-only new/edit/unpublish, cache TTL refresh, exact digest, card/detail/home cover, OG/Twitter/BlogPosting, draft isolation, sitemap/routes, PDF-only mobile rendering, hydration, 404, CMS failure 503')
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  if (server.exitCode === null) await once(server, 'exit')
  cms.closeAllConnections(); cms.close()
}
