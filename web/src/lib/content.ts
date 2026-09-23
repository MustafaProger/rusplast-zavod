import { createContext, useContext } from 'react'
import snapshot from '../data/cms-snapshot.json'
import siteMedia from '../data/site-media.json'
import type { Article } from '../data/editorial'
import type { Product } from '../types'

export type SiteDocument = { slug: string; title: string; subtitle: string; pdf: string; pages: string[] }
export type SiteContent = { products: Product[]; articles: Article[]; documents: SiteDocument[]; images: Record<string, string> }
export const initialContent = snapshot as SiteContent
export const ContentContext = createContext<SiteContent>(initialContent)
export const useContent = () => useContext(ContentContext)

type Media = { url?: string; formats?: { small?: Media; thumbnail?: Media } }
type Entry = Record<string, unknown>
export function mediaUrl(media: unknown, cmsUrl: string): string {
  const value = typeof media === 'string' ? media : (media as Media | null)?.url
  if (!value) return ''
  const url = new URL(value, cmsUrl)
  return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
}

export async function fetchCollection(cmsUrl: string, collection: string, populate: string, signal?: AbortSignal): Promise<Entry[]> {
  const entries: Entry[] = []
  let pageCount = 1
  for (let page = 1; page <= pageCount; page++) {
    const response = await fetch(`${cmsUrl}/api/${collection}?status=published&pagination[pageSize]=100&pagination[page]=${page}&sort=id:asc&${populate}`, { signal })
    if (!response.ok) throw new Error(`CMS ${collection}: ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload.data)) throw new Error(`Invalid CMS ${collection}`)
    entries.push(...payload.data)
    pageCount = payload.meta?.pagination?.pageCount ?? 1
    if (!Number.isInteger(pageCount) || pageCount > 100) throw new Error('Invalid CMS pagination')
  }
  return entries
}

export function normalizeProduct(entry: Entry, cmsUrl: string): Product {
  const photo = entry.photo as Media | undefined
  return { ...entry, price: Number(entry.price), image: mediaUrl(photo, cmsUrl) || String(entry.image || ''), imageThumbnail: mediaUrl(photo?.formats?.small || photo?.formats?.thumbnail || photo, cmsUrl) } as Product
}

export function normalizeArticle(entry: Entry, cmsUrl: string): Article {
  const article: Article = {
    slug: String(entry.slug), title: String(entry.title), seoTitle: String(entry.seoTitle),
    description: String(entry.description), category: String(entry.category),
    image: mediaUrl(entry.image, cmsUrl), imageAlt: String(entry.imageAlt || ''),
    intro: String(entry.intro), takeaway: String(entry.takeaway),
    sections: (entry.sections || []) as Article['sections'], sources: (entry.sources || []) as Article['sources'],
    related: (entry.related || []) as string[],
    publishedAt: String(entry.publishedOn || entry.publishedAt).slice(0, 10),
    author: String(entry.author || 'Редакция РУСПЛАСТЗАВОДА'),
  }
  if (entry.modifiedOn) article.modifiedAt = String(entry.modifiedOn).slice(0, 10)
  return article
}

export async function fetchSiteContent(cmsUrl: string, publicCmsUrl = cmsUrl, signal?: AbortSignal): Promise<SiteContent> {
  const [products, articles, documents] = await Promise.all([
    fetchCollection(cmsUrl, 'products', 'populate=photo', signal),
    fetchCollection(cmsUrl, 'articles', 'populate=image', signal),
    fetchCollection(cmsUrl, 'documents', 'populate[0]=file&populate[1]=pages', signal),
  ])
  return {
    images: Object.fromEntries([
      ...Object.entries(siteMedia).map(([key, url]) => [key, mediaUrl(url, publicCmsUrl)]),
      ...products.map(entry => [String(entry.sku), mediaUrl(entry.photo, publicCmsUrl)]),
      ...products.map(entry => [`/images/products/${entry.sku}.webp`, mediaUrl(entry.photo, publicCmsUrl)]),
    ]),
    products: products.map(entry => normalizeProduct(entry, publicCmsUrl)),
    articles: articles.map(entry => normalizeArticle(entry, publicCmsUrl)).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')),
    documents: documents.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)).map(entry => ({
      slug: String(entry.slug), title: String(entry.title), subtitle: String(entry.subtitle || ''),
      pdf: mediaUrl(entry.file, publicCmsUrl), pages: ((entry.pages || []) as Media[]).map(media => mediaUrl(media, publicCmsUrl)),
    })),
  }
}
