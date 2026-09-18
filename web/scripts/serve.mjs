import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const root = resolve('dist')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1]) || 4173
const host = args.includes('--host') ? args[args.indexOf('--host') + 1] : '127.0.0.1'
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.woff2': 'font/woff2' }
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end() }
    const canonical = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/'
    if (canonical !== path && (path.endsWith('/') || path.endsWith('.html'))) {
      res.writeHead(308, { Location: canonical + url.search }); return res.end()
    }
    if (canonical === '/proizvodstvo-stm') {
      res.writeHead(301, { Location: '/#about' }); return res.end()
    }
    if (canonical === '/certificates') {
      res.writeHead(301, { Location: '/#certificates' }); return res.end()
    }
    const candidates = path === '/' ? ['index.html'] : [path.slice(1) + '.html', path.slice(1)]
    let file
    for (const candidate of candidates) {
      const target = resolve(root, candidate)
      if (!target.startsWith(root + sep)) continue
      if (await stat(target).then(s => s.isFile()).catch(() => false)) { file = target; break }
    }
    const status = !file || path === '/404' ? 404 : 200
    file ||= resolve(root, '404.html')
    const body = await readFile(file)
    res.writeHead(status, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch { res.writeHead(400); res.end('Bad request') }
}).listen(port, host, () => console.log(`Static preview: http://${host}:${port}`))
