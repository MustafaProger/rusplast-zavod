/** Live CMS is the only editorial source. No local seed fallback on CMS failures. */
import https from 'node:https'
import os from 'node:os'

const site = 'https://rusplast-zavod.ru'
const cms = 'https://cms.rusplast-zavod.ru'
const networkInterface = process.env.RUSPLAST_NETWORK_INTERFACE
const interfaceAddress = networkInterface
  ? os.networkInterfaces()[networkInterface]?.find(address => address.family === 'IPv4' && !address.internal)?.address
  : null
if (networkInterface && !interfaceAddress) throw new Error(`Network interface unavailable: ${networkInterface}`)

async function cmsFetch(url, options) {
  if (!interfaceAddress) return fetch(url, options)
  return new Promise((resolve, reject) => {
    const request = https.get(url, { localAddress: interfaceAddress, signal: options?.signal }, response => {
      const chunks = []
      response.on('error', reject)
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: async () => JSON.parse(body.toString('utf8')),
        })
      })
    })
    request.on('error', reject)
  })
}
async function collection(name, populate = '') {
  const all = []
  for (let page = 1; page <= 100; page++) {
    let payload
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await cmsFetch(`${cms}/api/${name}?status=published&pagination[page]=${page}&pagination[pageSize]=100&sort=id:asc${populate}`, { signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw Object.assign(new Error(`CMS ${name} unavailable: ${response.status}`), { retryable: [408, 429, 500, 502, 503, 504].includes(response.status) })
        const body = await response.json()
        if (!Array.isArray(body.data)) throw Object.assign(new Error(`Invalid CMS ${name} response`), { retryable: false })
        payload = body
        break
      } catch (failure) {
        if (attempt === 2 || failure.retryable === false || failure instanceof SyntaxError) throw failure
        // Give transient connectivity/rate-limit failures time to recover. Never
        // replace a failed live read with stale local catalog or article data.
        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1500))
      }
    }
    all.push(...payload.data.map(item => ({ ...item, ...(item.attributes || {}) })))
    if (page >= (payload.meta?.pagination?.pageCount || 1)) return all
  }
  throw new Error(`CMS ${name} pagination exceeded limit`)
}
const results = await Promise.allSettled([
  collection('products', '&populate=photo'), collection('articles', '&populate=image'), collection('documents', '&populate=*'),
])
const failed = results.find(result => result.status === 'rejected')
if (failed) throw failed.reason
const [products, articles, documents] = results.map(result => result.value)
if (!products.length || !articles.length) throw new Error('CMS catalog or article collection is empty; refusing to invent editorial context')
const productFields = ['sku', 'slug', 'material', 'loadClass', 'color', 'outerDiameter', 'innerDiameter', 'coilLength', 'packageType', 'compression']
const assetUrl = value => value?.url ? new URL(value.url, cms).href : null
console.log(JSON.stringify({
  site, source: 'strapi', fetchedAt: new Date().toISOString(),
  articles: articles.map(({ slug, title, description, intro, publishedOn, sections }) => ({ slug, title, description, intro, publishedAt: publishedOn, headings: (sections || []).map(section => section.title) })),
  products: products.map(product => Object.fromEntries(productFields.filter(key => product[key] !== undefined).map(key => [key, product[key]]))),
  internalPaths: ['/', '/catalog', '/catalog/pvh', '/catalog/pnd', '/catalog/frhf', '/catalog/aksessuary', '/blog', '/#contacts', '/#certificates', '/#about', '/#delivery', '/#request', ...articles.map(article => `/blog/${article.slug}`)],
  documents: documents.map(document => assetUrl(document.file)).filter(Boolean),
  documentRecords: documents.map(document => ({ title: document.title, subtitle: document.subtitle, file: assetUrl(document.file) })),
  imagePolicy: 'A new unique photorealistic illustration must be generated for every article and uploaded to Strapi Media Library. Never reuse a stock cover or depict fictitious certificates or a real factory.',
  editorialRules: [
    'Цвет не доказывает материал и характеристики. Использовать только текущий ассортимент CMS.',
    'Не выдумывать пожарную безопасность, сертификаты, нормативы, испытания, экспертный опыт, цены, сроки, наличие и гарантии.',
    'Один самостоятельный вопрос покупателя на статью. Сверять тему со всеми опубликованными статьями.',
    'Естественный русский язык, конкретный вывод, полезный пример, минимум пять разделов, уместные ссылки и подтверждённые источники.',
    'Новая фотореалистичная обложка по содержанию статьи обязательна. Не изображать вымышленные документы, маркировку, логотипы или завод РУСПЛАСТЗАВОДА.',
  ],
}, null, 2))
