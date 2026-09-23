import { createServer } from 'vite'
import { writeFile } from 'node:fs/promises'
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', mode: 'production' })
try {
  const { fetchSiteContent } = await vite.ssrLoadModule('/src/lib/content.ts')
  const data = await fetchSiteContent(process.env.CMS_URL || 'https://cms.rusplast-zavod.ru', process.env.CMS_PUBLIC_URL || process.env.CMS_URL || 'https://cms.rusplast-zavod.ru', AbortSignal.timeout(30000))
  await writeFile('src/data/cms-snapshot.json', JSON.stringify(data, null, 2) + '\n')
  console.log(`CMS snapshot: ${data.products.length} products, ${data.articles.length} articles, ${data.documents.length} documents`)
} finally { await vite.close() }
