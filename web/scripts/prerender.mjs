import { createServer } from 'vite'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// Use the same React tree and metadata as the browser; no bot-specific content.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', mode: 'production' })
try {
  const { render, renderSeo, staticPaths, indexablePaths, SITE_URL } = await vite.ssrLoadModule('/src/entry-static.tsx')
  const template = await readFile(resolve('dist/index.html'), 'utf8')
  for (const path of staticPaths) {
    const target = resolve('dist', path === '/' ? 'index.html' : `${path.slice(1)}.html`)
    const html = template.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="description"[^>]*>/, '').replace('</head>', `${renderSeo(path)}\n</head>`).replace('<div id="root"></div>', `<div id="root">${render(path)}</div>`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, html)
  }
  const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  // Fallback for static hosts without the server-side legacy route redirect.
  await writeFile(resolve('dist/proizvodstvo-stm.html'), `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="robots" content="noindex, follow"><meta http-equiv="refresh" content="0;url=/#about"><link rel="canonical" href="${SITE_URL}/"><title>О заводе | РУСПЛАСТЗАВОД</title></head><body><a href="/#about">Перейти к разделу «О заводе»</a></body></html>`)
  await writeFile(resolve('dist/certificates.html'), `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="robots" content="noindex, follow"><meta http-equiv="refresh" content="0;url=/#certificates"><link rel="canonical" href="${SITE_URL}/"><title>Сертификаты | РУСПЛАСТЗАВОД</title></head><body><a href="/#certificates">Перейти к сертификатам на главной</a></body></html>`)
  const urls = indexablePaths.map(path => `  <url><loc>${escapeXml(SITE_URL + path)}</loc></url>`).join('\n')
  await writeFile(resolve('dist/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)
  await writeFile(resolve('dist/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`)
  await writeFile(resolve('dist/route-manifest.json'), JSON.stringify({ pages: staticPaths, indexable: indexablePaths, origin: SITE_URL }, null, 2))
  console.log(`Generated ${staticPaths.length} HTML pages and a sitemap with ${indexablePaths.length} canonical URLs.`)
} finally {
  await vite.close()
}
