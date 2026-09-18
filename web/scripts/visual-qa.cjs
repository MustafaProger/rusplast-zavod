const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5175'
const outputDir = process.env.QA_OUTPUT_DIR || path.join(require('node:os').tmpdir(), 'rusplast-visual-qa')

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) })

  try {
    const desktop = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 })
    await desktop.goto(base + '/', { waitUntil: 'networkidle' })
    await desktop.getByRole('heading', { name: 'Гофрированные трубы. От нашего завода.' }).waitFor()
    await desktop.screenshot({ path: path.join(outputDir, 'rpz-desktop-1536x1024.png'), fullPage: false })
    await desktop.locator('#certificates').screenshot({ path: path.join(outputDir, 'rpz-certificates.png') })
    await desktop.locator('#about').screenshot({ path: path.join(outputDir, 'rpz-production.png') })
    await desktop.locator('#delivery').screenshot({ path: path.join(outputDir, 'rpz-delivery.png') })
    await desktop.locator('.contact-cta').screenshot({ path: path.join(outputDir, 'rpz-contact-cta.png') })

    const desktopOverflow = await desktop.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (desktopOverflow > 1) throw new Error(`Desktop horizontal overflow: ${desktopOverflow}px`)
    await desktop.goto(base + '/catalog', { waitUntil: 'networkidle' })
    await desktop.locator('#catalog').screenshot({ path: path.join(outputDir, 'rpz-catalog.png') })

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
    await mobile.goto(base + '/', { waitUntil: 'networkidle' })
    await mobile.getByRole('heading', { name: 'Гофрированные трубы. От нашего завода.' }).waitFor()
    await mobile.screenshot({ path: path.join(outputDir, 'rpz-mobile-390x844.png'), fullPage: false })

    const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (mobileOverflow > 1) throw new Error(`Mobile horizontal overflow: ${mobileOverflow}px`)
    const mobileHeadingFits = await mobile.getByRole('heading', { name: 'Гофрированные трубы. От нашего завода.' }).evaluate(element => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth && element.scrollWidth <= element.clientWidth + 1
    })
    if (!mobileHeadingFits) throw new Error('Mobile hero heading is clipped')

    await mobile.getByRole('link', { name: 'Выбрать продукцию', exact: true }).click()
    await mobile.waitForURL(base + '/catalog')
    await mobile.getByRole('button', { name: 'Фильтры' }).click()
    await mobile.getByRole('button', { name: 'ПНД', exact: true }).click()
    const materials = await mobile.locator('.product-kind').allTextContents()
    if (!materials.length || materials.some(value => !value.includes('ПНД'))) throw new Error('Material filter did not apply')
    await mobile.getByRole('button', { name: /Подробнее:/ }).first().click()
    await mobile.getByRole('dialog').waitFor()
    await mobile.getByRole('button', { name: 'Добавить в заявку' }).click()
    await mobile.getByRole('button', { name: 'Добавлено в заявку' }).waitFor()

    console.log(JSON.stringify({ desktop: '1536x1024', mobile: '390x844', desktopOverflow, mobileOverflow, mobileHeadingFits, modalAndSelection: true, outputDir }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
