import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const manifest = JSON.parse(await readFile('dist/route-manifest.json', 'utf8'))
const seed = JSON.parse(await readFile('src/data/products.json', 'utf8'))
const port = Number(process.env.QA_PORT || 4181)
const base = `http://127.0.0.1:${port}`
const output = resolve(process.env.QA_OUTPUT_DIR || `${tmpdir()}/rusplast-seo-qa`)
await mkdir(output, { recursive: true })
const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { stdio: 'pipe' })
let browser
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break
    if (i === 99) throw new Error('Preview server did not start')
    await new Promise(r => setTimeout(r, 100))
  }
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) })
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } })
  const page = await noJs.newPage()
  const titles = new Set(), descriptions = new Set(), links = new Set()
  const articleChecks = []
  for (const path of manifest.pages) {
    const response = await page.goto(base + path)
    assert.equal(response.status(), path === '/404' ? 404 : 200, `HTTP ${path}`)
    assert.equal(await page.locator('h1').count(), 1, `one H1: ${path}`)
    assert.equal(await page.locator('link[rel=canonical]').count(), 1, `one canonical: ${path}`)
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), manifest.origin + path)
    const title = await page.title()
    const description = await page.locator('meta[name=description]').getAttribute('content')
    assert(!titles.has(title), `unique title: ${path}`); titles.add(title)
    assert(!descriptions.has(description), `unique description: ${path}`); descriptions.add(description)
    const schema = JSON.parse(await page.locator('#page-schema').textContent())
    assert.equal(schema['@context'], 'https://schema.org')
    assert(schema['@graph'].some(item => item['@type'] === 'Organization'))
    if (path === '/') {
      assert(await page.getByRole('button', { name: 'Отправить заявку', exact: true }).isDisabled(), 'No-JS form cannot submit contact data')
      assert.equal(await page.locator('form.lead-form').getAttribute('method'), 'post')
      assert.equal(await page.locator('#catalog, .catalog-directory, .product-row').count(), 0, 'No catalog products or category filters on the homepage')
      assert.equal(await page.locator('#certificates').count(), 1, 'Documents appear once on the homepage')
      assert.equal(await page.locator('.certificate-card').count(), 6)
      assert.equal(await page.locator('.document-direct-links, #certificates a[href$=".pdf"]').count(), 0, 'No duplicate PDF links below cards')
    }
    if (await page.locator('#main-navigation').count()) {
      assert.deepEqual(await page.locator('#main-navigation a[href^="/"]').allTextContents(), ['Главная', 'Каталог', 'Блог'])
    }
    assert.deepEqual(await page.locator('nav[aria-label="Навигация в подвале"] a').allTextContents(), ['Главная', 'Каталог', 'Блог'])
    if (path === '/blog') {
      assert.equal(await page.locator('.article-card-featured').count(), 0)
      assert.equal(await page.locator('.article-grid > .article-card').count(), 6, 'All articles belong to the same grid')
    }
    for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')))) {
      if (href.startsWith('/') || href.startsWith('#')) links.add(new URL(href, base + path).href)
    }
    if (path.startsWith('/blog/')) {
      const article = schema['@graph'].find(item => item['@type'] === 'BlogPosting')
      assert(article, `BlogPosting: ${path}`)
      assert.equal(article.headline, await page.locator('h1').textContent())
      assert(await page.locator('.prose-section').count() >= 5)
      const words = (await page.locator('.article-body').innerText()).split(/\s+/).length
      assert(words > 400, `article substance: ${path}`)
      articleChecks.push({ path, words })
    }
    if (path === '/catalog') assert.equal(await page.locator('.product-row').count(), 16, 'all products visible without JS')
    if (path === '/catalog/pvh' || path === '/catalog/pnd') assert.equal(await page.locator('.product-row').count(), 8)
  }
  assert.equal(articleChecks.length, 6)
  for (const href of links) {
    const url = new URL(href)
    const response = await fetch(url)
    assert.equal(response.status, url.pathname === '/404' ? 404 : 200, `working internal link: ${href}`)
    if (url.hash) {
      const html = await response.text()
      assert(html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `anchor exists: ${href}`)
    }
  }
  const sitemap = await fetch(`${base}/sitemap.xml`).then(r => r.text())
  const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])
  assert.deepEqual(locs, manifest.indexable.map(path => manifest.origin + path))
  assert(!sitemap.includes('/404'))
  assert((await fetch(`${base}/robots.txt`).then(r => r.text())).includes(`Sitemap: ${manifest.origin}/sitemap.xml`))
  assert.equal((await fetch(`${base}/unknown-seo-page`)).status, 404)
  assert.equal((await fetch(`${base}/blog/`, { redirect: 'manual' })).status, 308)
  assert.equal((await fetch(`${base}/blog.html`, { redirect: 'manual' })).headers.get('location'), '/blog')
  const stmRedirect = await fetch(`${base}/proizvodstvo-stm`, { redirect: 'manual' })
  assert.equal(stmRedirect.status, 301)
  assert.equal(stmRedirect.headers.get('location'), '/#about')
  const certificatesRedirect = await fetch(`${base}/certificates`, { redirect: 'manual' })
  assert.equal(certificatesRedirect.status, 301)
  assert.equal(certificatesRedirect.headers.get('location'), '/#certificates')
  assert(!manifest.indexable.includes('/certificates'))
  await noJs.close()

  const errors = []
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  // Isolate frontend routing and hydration from CMS availability; do not submit leads.
  await context.route('**/api/products?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: seed }) }))
  const ui = await context.newPage()
  ui.on('pageerror', error => errors.push(error.message))
  ui.on('console', message => { if (message.type() === 'error' && !message.text().includes('status of 404 (Not Found)')) errors.push(message.text()) })
  const layouts = []
  for (const width of [1440, 768, 390, 320]) {
    await ui.setViewportSize({ width, height: 1000 })
    for (const path of ['/', '/blog', '/blog/gofra-pvh-ili-pnd', '/blog/dokumenty-na-gofrotrubu', '/catalog', '/catalog/pvh', '/catalog/pnd', '/catalog/frhf', '/catalog/aksessuary']) {
      await ui.goto(base + path, { waitUntil: 'networkidle' })
      const overflow = await ui.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert(overflow <= 1, `${width}px overflow at ${path}: ${overflow}`)
      const images = await ui.locator('img').evaluateAll(nodes => nodes.filter(img => img.loading !== 'lazy' && (!img.complete || !img.naturalWidth)).map(img => img.src))
      assert.deepEqual(images, [], `loaded hero images: ${path}`)
      layouts.push({ width, path, overflow })
      if ((width === 1440 || width === 390) && ['/', '/blog', '/blog/gofra-pvh-ili-pnd', '/catalog/pvh'].includes(path)) {
        await ui.screenshot({ path: `${output}/${path.replaceAll('/', '-') || 'home'}-${width}.png`, fullPage: true })
      }
    }
  }
  await ui.setViewportSize({ width: 390, height: 844 })
  await ui.goto(base + '/catalog', { waitUntil: 'networkidle' })
  await ui.getByRole('button', { name: 'Фильтры', exact: true }).click()
  await ui.getByRole('button', { name: 'ПНД', exact: true }).click()
  await ui.getByRole('button', { name: 'Оранжевый', exact: true }).click()
  assert.equal(await ui.locator('.product-row').count(), 4)
  await ui.getByRole('button', { name: /^Подробнее:/ }).first().click()
  await ui.getByRole('dialog').waitFor()
  await ui.getByRole('button', { name: 'Добавить в заявку', exact: true }).click()
  await ui.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await ui.goto(base + '/blog', { waitUntil: 'networkidle' })
  await ui.getByRole('button', { name: 'В заявке: 1', exact: true }).click()
  assert.equal(await ui.locator('.selected-products li').count(), 1)
  assert(await ui.getByRole('button', { name: 'Отправить заявку', exact: true }).isEnabled(), 'Form enabled after hydration')
  await ui.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await ui.getByRole('button', { name: 'Открыть меню', exact: true }).click()
  await ui.locator('#main-navigation').getByRole('link', { name: 'Блог', exact: true }).click()
  await ui.waitForURL(base + '/blog')
  await ui.goto(base + '/#certificates', { waitUntil: 'networkidle' })
  await ui.waitForURL(base + '/#certificates')
  await ui.getByRole('button', { name: 'Открыть документ: Сертификат соответствия ЕАЭС', exact: true }).click()
  await ui.getByRole('dialog').getByRole('button', { name: 'Следующая страница', exact: true }).click()
  assert.equal(await ui.locator('.document-controls [aria-live]').textContent(), '2 / 2')
  await ui.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const navigationChecks = []
  for (const width of [1440, 390]) {
    await ui.setViewportSize({ width, height: 844 })
    for (const source of ['/catalog', '/blog']) {
      await ui.goto(base + source, { waitUntil: 'networkidle' })
      if (width < 960) await ui.getByRole('button', { name: 'Открыть меню', exact: true }).click()
      await ui.locator('#main-navigation').getByRole('link', { name: 'Главная', exact: true }).click()
      await ui.waitForURL(base + '/')
      await ui.getByRole('heading', { name: 'Гофрированные трубы. От нашего завода.', exact: true }).waitFor()
      assert.equal(await ui.locator('body.menu-open').count(), 0)
      assert.equal(await ui.locator('#catalog, .catalog-directory, .product-row').count(), 0)
      navigationChecks.push({ width, source, target: '/' })
    }
    await ui.getByRole('link', { name: 'Выбрать продукцию', exact: true }).click()
    await ui.waitForURL(base + '/catalog')
    assert.equal(await ui.locator('.product-row').count(), 16)
    await ui.goto(base + '/certificates', { waitUntil: 'networkidle' })
    await ui.waitForURL(base + '/#certificates')
    await ui.waitForFunction(() => {
      const top = document.getElementById('certificates').getBoundingClientRect().top
      return top >= 64 && top < innerHeight / 2
    })
    assert.equal(await ui.locator('.certificate-card').count(), 6)
    const cards = await ui.locator('.certificate-card').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top }
    }))
    assert(cards.every(card => card.left >= 0 && card.right <= width), 'Every document fits in the grid')
    assert(cards[3].top > cards[0].top, 'Protocols are visible in subsequent rows')
    assert.equal(await ui.locator('#main-navigation a[href="/proizvodstvo-stm"]').count(), 0)
    for (let index = 0; index < 6; index++) {
      const card = ui.locator('.certificate-card').nth(index)
      await card.scrollIntoViewIfNeeded()
      await card.locator('img').evaluate(img => img.decode())
      await card.click()
      const pageCount = [2, 1, 1, 6, 6, 10][index]
      for (let page = 0; page < pageCount; page++) {
        assert.equal(await ui.locator('.document-controls [aria-live]').textContent(), `${page + 1} / ${pageCount}`)
        await ui.locator('.document-slide[aria-hidden="false"] img').evaluate(img => img.decode())
        if (page + 1 < pageCount) await ui.getByRole('button', { name: 'Следующая страница', exact: true }).click()
      }
      await ui.getByRole('button', { name: 'Увеличить документ', exact: true }).click()
      assert(await ui.locator('.document-slides.is-zoomed').count())
      await ui.getByRole('button', { name: 'Уменьшить документ', exact: true }).click()
      const pdf = await ui.getByRole('link', { name: 'Скачать оригинал PDF', exact: true }).getAttribute('href')
      assert.equal((await fetch(base + pdf)).status, 200)
      await ui.getByRole('button', { name: 'Закрыть', exact: true }).click()
    }
  }
  await ui.goto(base + '/does-not-exist', { waitUntil: 'networkidle' })
  assert.equal(await ui.locator('meta[name=robots]').getAttribute('content'), 'noindex, follow')
  assert.deepEqual(errors, [], 'No browser or hydration errors')
  const result = { staticPages: manifest.pages.length, indexablePages: locs.length, internalLinks: links.size, articles: articleChecks, layoutChecks: layouts.length, viewportWidths: [1440, 768, 390, 320], noJsContent: true, real404: true, hydrationErrors: errors, colorFilter: true, cartAcrossRoutes: true, certificateViewer: true, documentPagesChecked: 26, navigationChecks, backend: 'Product API fixture; no leads submitted', output }
  await import('node:fs/promises').then(fs => fs.writeFile(`${output}/results.json`, JSON.stringify(result, null, 2)))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close()
  server.kill()
}
