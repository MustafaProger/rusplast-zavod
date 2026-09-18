import { articles, articlePath } from '../data/editorial'
import { landingPages } from '../data/pages'

const configuredOrigin = import.meta.env.VITE_SITE_URL || 'https://rusplast-zavod.ru'
export const SITE_URL = new URL(configuredOrigin).origin
const siteName = 'РУСПЛАСТЗАВОД'
const organizationId = `${SITE_URL}/#organization`
export const legalTitles: Record<string, string> = {
  '/privacy': 'Политика конфиденциальности',
  '/terms': 'Пользовательское соглашение',
  '/consent': 'Согласие на обработку персональных данных',
}
export const indexablePaths = ['/', '/catalog', ...landingPages.map(page => page.path), '/blog', ...articles.map(articlePath)]
export const staticPaths = [...indexablePaths, ...Object.keys(legalTitles), '/404']
export const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/'

export function getSeo(rawPath: string) {
  const path = normalizePath(rawPath)
  const article = articles.find(item => articlePath(item) === path)
  const landing = landingPages.find(item => item.path === path)
  const exists = staticPaths.includes(path) && path !== '/404'
  const label = article?.title || landing?.label || ({ '/': siteName, '/catalog': 'Каталог продукции', '/blog': 'Блог' } as Record<string, string>)[path] || legalTitles[path] || 'Страница не найдена'
  const title = article ? `${article.seoTitle} | ${siteName}` : landing ? `${landing.title} | ${siteName}` : path === '/' ? 'Гофрированные трубы ПВХ и ПНД от производителя | РУСПЛАСТЗАВОД' : `${label} | ${siteName}`
  const description = article?.description || landing?.description || ({
    '/': 'РУСПЛАСТЗАВОД — производитель гофротруб ПВХ и ПНД в Московской области. Каталог 16–32 мм, комплектующие, заказные FRHF и производство под СТМ.',
    '/catalog': 'Каталог гофрированных труб ПВХ и ПНД 16–32 мм: характеристики, фильтры и расчёт поставки. FRHF под заказ, клипсы и комплектующие от РУСПЛАСТЗАВОДА.',
    '/blog': 'Блог РУСПЛАСТЗАВОДА: выбор гофры ПВХ, ПНД и FRHF, диаметры, нагрузка, документы и производство под СТМ. Практические материалы для закупки.',
  } as Record<string, string>)[path] || `${label}. ООО «РУСПЛАСТЗАВОД».`
  const canonical = `${SITE_URL}${exists ? path : '/404'}`
  const image = `${SITE_URL}/images/optimized/${article?.image || landing?.image || 'hero-pipes'}-1280.webp`
  const graph: Record<string, unknown>[] = [
    { '@type': 'Organization', '@id': organizationId, name: siteName, legalName: 'ООО «РУСПЛАСТЗАВОД»', url: SITE_URL, logo: `${SITE_URL}/favicon.svg`, foundingDate: '2021', taxID: '9721122788', telephone: '+7-966-007-05-01', email: 'rusplastzavod@gmail.com', address: { '@type': 'PostalAddress', addressCountry: 'RU', addressLocality: 'Москва', streetAddress: 'проспект Андропова, д. 10, помещение 98' }, location: { '@type': 'Place', name: 'Производство и склад РУСПЛАСТЗАВОДА', address: { '@type': 'PostalAddress', addressCountry: 'RU', addressRegion: 'Московская область', addressLocality: 'посёлок Рылеево, Раменский район', streetAddress: '608/1' } } },
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: SITE_URL, name: siteName, inLanguage: 'ru-RU', publisher: { '@id': organizationId } },
    { '@type': path === '/blog' || path.startsWith('/catalog') ? 'CollectionPage' : 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: title, description, inLanguage: 'ru-RU', isPartOf: { '@id': `${SITE_URL}/#website` }, ...(article ? { mainEntity: { '@id': `${canonical}#article` } } : {}) },
  ]
  if (article || landing || path === '/catalog' || path === '/blog') {
    const crumbs = [{ name: 'Главная', item: `${SITE_URL}/` }]
    if (article) crumbs.push({ name: 'Блог', item: `${SITE_URL}/blog` })
    if (landing?.path.startsWith('/catalog/')) crumbs.push({ name: 'Каталог', item: `${SITE_URL}/catalog` })
    crumbs.push({ name: label, item: canonical })
    graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs.map((item, index) => ({ '@type': 'ListItem', position: index + 1, ...item })) })
  }
  if (article) graph.push({ '@type': 'BlogPosting', '@id': `${canonical}#article`, headline: article.title, description, image, inLanguage: 'ru-RU', mainEntityOfPage: { '@id': `${canonical}#webpage` }, publisher: { '@id': organizationId }, dateCreated: '2026-09-18', about: article.category, citation: article.sources.map(source => new URL(source.href, SITE_URL).href) })
  if (path === '/blog') graph.push({ '@type': 'ItemList', itemListElement: articles.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.title, url: `${SITE_URL}${articlePath(item)}` })) })
  return { title, description, canonical, image, exists, robots: exists ? 'index, follow, max-image-preview:large' : 'noindex, follow', type: article ? 'article' : 'website', schema: { '@context': 'https://schema.org', '@graph': graph } }
}

export function applySeo(path: string) {
  const seo = getSeo(path)
  document.title = seo.title
  const values = { description: seo.description, robots: seo.robots, 'og:title': seo.title, 'og:description': seo.description, 'og:url': seo.canonical, 'og:type': seo.type, 'og:image': seo.image, 'og:locale': 'ru_RU', 'og:site_name': siteName, 'twitter:card': 'summary_large_image', 'twitter:title': seo.title, 'twitter:description': seo.description, 'twitter:image': seo.image }
  for (const [name, content] of Object.entries(values)) {
    const attr = name.startsWith('og:') ? 'property' : 'name'
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
    if (!element) { element = document.createElement('meta'); element.setAttribute(attr, name); document.head.append(element) }
    element.content = content
  }
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical) }
  canonical.href = seo.canonical
  let schema = document.getElementById('page-schema')
  if (!schema) { schema = document.createElement('script'); schema.id = 'page-schema'; schema.setAttribute('type', 'application/ld+json'); document.head.append(schema) }
  schema.textContent = JSON.stringify(seo.schema)
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export function renderSeo(path: string) {
  const seo = getSeo(path)
  return `<title>${escapeHtml(seo.title)}</title>\n<meta name="description" content="${escapeHtml(seo.description)}" />\n<meta name="robots" content="${seo.robots}" />\n<link rel="canonical" href="${escapeHtml(seo.canonical)}" />\n${Object.entries({ 'og:title': seo.title, 'og:description': seo.description, 'og:url': seo.canonical, 'og:type': seo.type, 'og:image': seo.image, 'og:locale': 'ru_RU', 'og:site_name': siteName }).map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}" />`).join('\n')}\n<meta name="twitter:card" content="summary_large_image" />\n<meta name="twitter:title" content="${escapeHtml(seo.title)}" />\n<meta name="twitter:description" content="${escapeHtml(seo.description)}" />\n<meta name="twitter:image" content="${escapeHtml(seo.image)}" />\n<script id="page-schema" type="application/ld+json">${JSON.stringify(seo.schema).replace(/</g, '\\u003c')}</script>`
}
