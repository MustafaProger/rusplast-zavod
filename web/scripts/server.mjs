import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { render, renderSeo, getSeo, getStaticPaths, getIndexablePaths, SITE_URL, fetchSiteContent } from '../dist-server/entry-static.js'

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const template = await readFile(resolve(root, 'shell.html'), 'utf8')
const cms = (process.env.CMS_INTERNAL_URL || process.env.CMS_URL || 'https://cms.rusplast-zavod.ru').replace(/\/$/, '')
const publicCms = process.env.CMS_PUBLIC_URL || 'https://cms.rusplast-zavod.ru'
const cacheMs = Math.max(0, Number(process.env.CONTENT_CACHE_MS ?? 15000))
let cached, refreshed = 0, pending
async function content() {
  if (cached && Date.now() - refreshed < cacheMs) return cached
  if (!pending) pending = fetchSiteContent(cms, publicCms, AbortSignal.timeout(10000)).then(result => {
    cached = result; refreshed = Date.now(); return result
  }).finally(() => { pending = undefined })
  // Never resurrect unpublished content from the build seed when CMS is offline.
  return pending
}
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const escapeXml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
createServer(async (req, res) => {
  const send = (status, body, type, extra = {}) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...extra })
    res.end(req.method === 'HEAD' ? undefined : bytes)
  }
  try {
    const url = new URL(req.url, 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    if (path.startsWith('/api/')) {
      const read = /^\/api\/(products|articles|documents)(\/[a-z0-9]+)?$/.test(path) && ['GET', 'HEAD'].includes(req.method)
      const createLead = path === '/api/leads' && req.method === 'POST'
      if (!read && !createLead) return send(404, 'Not found', 'text/plain')
      let body
      if (createLead) {
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 131072) return send(413, 'Request too large', 'text/plain'); chunks.push(chunk) }
        body = Buffer.concat(chunks)
      }
      const response = await fetch(cms + url.pathname + url.search, { method: req.method, body,
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''), 'X-Forwarded-Proto': 'https' }, signal: AbortSignal.timeout(45000) })
      return send(response.status, Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') || 'application/json', { 'Cache-Control': 'no-store' })
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' })
    if (path.startsWith('/uploads/')) { res.writeHead(308, { Location: publicCms + url.pathname }); return res.end() }
    if (path === '/healthz') return send(200, 'ok', 'text/plain')
    const canonical = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/'
    if (canonical !== path && (path.endsWith('/') || path.endsWith('.html'))) { res.writeHead(308, { Location: canonical + url.search }); return res.end() }
    const redirect = { '/proizvodstvo-stm': '/#about', '/certificates': '/#certificates' }[path]
    if (redirect) { res.writeHead(301, { Location: redirect }); return res.end() }
    if (/^\/documents\/[a-z0-9-]+\.pdf$/.test(path)) {
      const data = await content()
      const doc = data.documents.find(item => path === `/documents/${item.slug}.pdf`)
      if (doc) {
        const source = new URL(doc.pdf)
        if (source.origin !== new URL(publicCms).origin || !source.pathname.startsWith('/uploads/')) throw new Error('Invalid document media origin')
        const response = await fetch(cms + source.pathname, { signal: AbortSignal.timeout(20000) })
        if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('Document unavailable')
        return send(200, Buffer.from(await response.arrayBuffer()), 'application/pdf', { 'Content-Disposition': `inline; filename="${doc.slug}.pdf"`, 'Cache-Control': 'no-cache' })
      }
    }
    // Only public assets are served from disk. HTML/manifests always reflect CMS.
    if (/^\/(assets|images|documents)\//.test(path) || ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png'].includes(path)) {
      const target = resolve(root, '.' + path)
      if (target.startsWith(root + sep) && mime[extname(target)] && await stat(target).then(s => s.isFile()).catch(() => false)) return send(200, await readFile(target), mime[extname(target)], { 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' })
      return send(404, 'Not found', 'text/plain')
    }
    const data = await content()
    const paths = getIndexablePaths(data.articles)
    if (path === '/sitemap.xml') {
      const dates = new Map(data.articles.map(a => [`/blog/${a.slug}`, a.modifiedAt || a.publishedAt]))
      return send(200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>${escapeXml(SITE_URL + p)}</loc>${dates.get(p) ? `<lastmod>${escapeXml(dates.get(p))}</lastmod>` : ''}</url>`).join('')}</urlset>`, 'application/xml; charset=utf-8', { 'Cache-Control': 'no-cache' })
    }
    if (path === '/robots.txt') return send(200, `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'text/plain')
    if (path === '/route-manifest.json') return send(200, JSON.stringify({ pages: getStaticPaths(data.articles), indexable: paths, origin: SITE_URL }), 'application/json', { 'Cache-Control': 'no-store' })
    if (path === '/publication-manifest.json') return send(200, JSON.stringify({ articles: Object.fromEntries(data.articles.map(a => [a.slug, { sha256: hash(a), publishedAt: a.publishedAt }])) }), 'application/json', { 'Cache-Control': 'no-store' })
    const seo = getSeo(path, data.articles, data.images)
    const serialized = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    const html = template.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="description"[^>]*>/, '').replace('</head>', `${renderSeo(path, data.articles, data.images)}\n<script>window.__RPZ_CONTENT__=${serialized}</script>\n</head>`).replace('<div id="root"></div>', `<div id="root">${render(path, data)}</div>`)
    send(seo.exists ? 200 : 404, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' })
  } catch (error) {
    console.error('Page unavailable:', error.message)
    send(503, 'Сайт временно недоступен. Пожалуйста, повторите попытку позже.', 'text/plain; charset=utf-8', { 'Retry-After': '15', 'Cache-Control': 'no-store' })
  }
}).listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => console.log('CMS website server ready'))
