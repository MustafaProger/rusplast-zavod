import { initialContent, normalizeProduct } from './content'
import type { LeadPayload, Product } from '../types'

const CMS_URL = (import.meta.env.VITE_CMS_URL || 'http://localhost:1337').replace(/\/$/, '')

export async function getProducts(signal?: AbortSignal): Promise<{ products: Product[]; source: 'cms' | 'seed' }> {
  try {
    const products: Product[] = []
    let page = 1
    let pageCount = 1
    do {
      // Stable transport order keeps pagination reliable. Catalog presentation
      // groups products by their attributes after every page has been loaded.
      const response = await fetch(`${CMS_URL}/api/products?pagination[pageSize]=100&pagination[page]=${page}&sort=id:asc&populate=photo`, { signal })
      if (!response.ok) throw new Error(`CMS responded ${response.status}`)
      const payload = (await response.json()) as { data?: Product[]; meta?: { pagination?: { pageCount?: number } } }
      if (!Array.isArray(payload.data)) throw new Error('Invalid CMS catalog')
      products.push(...payload.data.map(product => normalizeProduct(product as unknown as Record<string, unknown>, CMS_URL)))
      pageCount = payload.meta?.pagination?.pageCount ?? 1
      page += 1
    } while (page <= pageCount)
    return { products, source: 'cms' }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { products: initialContent.products, source: 'seed' }
  }
}

export async function createLead(payload: LeadPayload): Promise<void> {
  const response = await fetch(`${CMS_URL}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw new Error(`CMS responded ${response.status}`)
  const result = await response.json()
  if (!result.data?.documentId && !result.data?.id) throw new Error('No lead confirmation')
}
