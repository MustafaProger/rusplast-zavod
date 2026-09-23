import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium, devices, webkit } from 'playwright'
import { createServer } from 'vite'

const seed = JSON.parse(await readFile(new URL('../src/data/products.json', import.meta.url), 'utf8'))
const expectedSkus = ['2021022', '2021024', '2021026', '2021031', '2021028', '2021030', '2021032', '2021033', '2021001', '2021005', '2021017', '2021018', '2021002', '2021006', '2021010', '2021011']
const vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await vite.listen()
const base = vite.resolvedUrls.local[0].replace(/\/$/, '')

try {
  const { sortCatalogProducts } = await vite.ssrLoadModule('/src/lib/catalog-order.ts')
  const reversed = [...seed].reverse()
  assert.deepEqual(sortCatalogProducts(reversed).map(product => product.sku), expectedSkus, 'requested series and diameter order')
  assert.equal(reversed[0].sku, seed.at(-1).sku, 'sorting does not mutate API data')
  const future = { ...seed[0], sku: 'future-40', outerDiameter: 40 }
  const unknownDiameter = { ...seed[0], sku: 'future-null', outerDiameter: null }
  assert.deepEqual(sortCatalogProducts([unknownDiameter, ...reversed, future]).slice(0, 7).map(product => product.sku), [...expectedSkus.slice(0, 4), 'future-40', 'future-null', expectedSkus[4]], 'future sizes join their series; missing diameter goes last')
  const normalized = seed.map(product => ({ ...product, material: ` ${product.material.toLowerCase()} `, loadClass: product.loadClass.replace('е', 'ё'), color: product.color.replace('Чер', 'Чёр') }))
  assert.deepEqual(sortCatalogProducts(normalized.reverse()).map(product => product.sku), expectedSkus, 'case, whitespace and ё do not change series order')

  // More than one CMS page, deliberately returned in the former diameter order.
  const products = [...seed, ...Array.from({ length: 101 }, (_, index) => ({ ...future, sku: `future-${index + 1}`, slug: `future-${index + 1}`, name: `Труба ПВХ 40 мм ${index + 1}` }))]
    .sort((a, b) => a.outerDiameter - b.outerDiameter || a.sku.localeCompare(b.sku))
  const expectedExpanded = [...expectedSkus.slice(0, 4), ...Array.from({ length: 101 }, (_, index) => `future-${index + 1}`), ...expectedSkus.slice(4)]
  const results = []
  for (const [engine, device] of [[chromium, devices['Pixel 7']], [webkit, devices['iPhone 13']]]) {
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    const browser = await engine.launch({ headless: true, ...(engine === chromium && existsSync(chromePath) ? { executablePath: chromePath } : {}) })
    try {
      const context = await browser.newContext(device)
      const requests = []
      await context.route('**/api/products?**', async route => {
        const url = new URL(route.request().url())
        const page = Number(url.searchParams.get('pagination[page]') || 1)
        requests.push(page)
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: products.slice((page - 1) * 100, page * 100), meta: { pagination: { page, pageCount: 2, total: products.length } } }) })
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push({ name: error.name, message: error.message, stack: error.stack }))
      await page.goto(`${base}/catalog`, { waitUntil: 'networkidle' })
      assert.deepEqual([...new Set(requests)], [1, 2], 'load all CMS pages, including under React StrictMode')
      assert.deepEqual((await page.locator('.product-sku').allTextContents()).map(text => text.replace('Арт. ', '')), expectedExpanded, 'catalog keeps the requested order after CMS fetch')
      await page.getByRole('button', { name: 'Фильтры', exact: true }).tap()
      await page.getByRole('button', { name: '40 мм', exact: true }).tap()
      assert.equal(await page.locator('.product-row').count(), 101, 'new diameter is filterable')
      await page.getByRole('group', { name: 'Диаметр', exact: true }).getByRole('button', { name: 'Все', exact: true }).tap()
      await page.getByRole('button', { name: 'ПНД', exact: true }).tap()
      assert.deepEqual((await page.locator('.product-sku').allTextContents()).map(text => text.replace('Арт. ', '')), expectedSkus.slice(8), 'filters preserve series order')

      const menu = page.locator('.menu-button')
      const checkMenu = async expected => {
        await page.waitForFunction(value => document.querySelector('.menu-button')?.getAttribute('aria-expanded') === value, expected, { timeout: 2000 })
        assert.equal(await menu.getAttribute('aria-expanded'), expected)
      }
      const isOpen = () => checkMenu('true')
      const isClosed = () => checkMenu('false')
      await page.evaluate(() => window.scrollTo(0, 0))
      await menu.tap()
      await isOpen()
      assert.equal(await page.locator('#main-navigation a').first().evaluate(element => element === document.activeElement), false, 'touch opening does not move focus to a link')
      await page.locator('#main-navigation a').first().evaluate(element => { element.focus(); element.blur() })
      await isOpen() // Safari/touch blur has relatedTarget=null; this failed before the fix.
      await page.setViewportSize({ width: device.viewport.width, height: 620 })
      await isOpen()
      await page.setViewportSize({ width: device.viewport.width, height: 240 })
      const geometry = await page.locator('#main-navigation').evaluate(element => {
        element.scrollTop = element.scrollHeight
        const rect = element.getBoundingClientRect()
        return { scrollTop: element.scrollTop, bottom: rect.bottom, viewport: innerHeight }
      })
      assert.ok(geometry.scrollTop > 0, 'menu scrolls on short phone viewports')
      assert.ok(geometry.bottom <= geometry.viewport + 1, 'menu fits inside viewport')
      await isOpen()
      await page.setViewportSize(device.viewport)
      await menu.tap()
      await isClosed()
      await menu.tap()
      const outsideY = await page.locator('#main-navigation').evaluate(element => element.getBoundingClientRect().bottom + 24)
      await page.touchscreen.tap(8, outsideY)
      await isClosed()
      await menu.tap()
      await page.locator('#main-navigation').getByRole('link', { name: 'Блог', exact: true }).tap()
      await page.waitForURL(`${base}/blog`)
      await isClosed()

      await menu.focus()
      await page.keyboard.press('Enter')
      await isOpen()
      assert.equal(await page.locator('#main-navigation a').first().evaluate(element => element === document.activeElement), true, 'keyboard opening focuses the first link')
      await page.keyboard.press('Escape')
      await isClosed()
      assert.equal(await menu.evaluate(element => element === document.activeElement), true, 'Escape restores focus')
      await page.keyboard.press('Enter')
      // macOS WebKit includes links in sequential focus with Option+Tab.
      const previousLink = engine === webkit ? 'Alt+Shift+Tab' : 'Shift+Tab'
      await page.keyboard.press(previousLink)
      await page.keyboard.press(previousLink)
      await isClosed()

      await menu.tap()
      await page.setViewportSize({ width: 1100, height: 850 })
      await isClosed()
      await page.setViewportSize(device.viewport)
      await isClosed()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no mobile horizontal overflow')
      // System Chrome emits this stackless internal rejection on a plain link
      // navigation, including pages with no View Transition API or CSS opt-in.
      // Report it separately; every application error still fails the check.
      const browserWarnings = errors.filter(error => engine === chromium && error.name === 'InvalidStateError' && !error.stack && error.message === 'Transition was aborted because of invalid state. ViewTransition opt-in disabled')
      assert.deepEqual(errors.filter(error => !browserWarnings.includes(error)), [], `${engine.name()}: no uncaught application errors`)
      results.push({ browser: engine.name(), touch: true, menu: 'passed', keyboard: 'passed', viewportAndScroll: 'passed', catalog: products.length, cmsPages: 2, newDiameterFilter: 'passed', browserWarnings: browserWarnings.map(error => error.message) })
      await context.close()
    } finally {
      await browser.close()
    }
  }
  console.log(JSON.stringify({ sorting: 'passed', browsers: results }, null, 2))
} finally {
  await vite.close()
}
