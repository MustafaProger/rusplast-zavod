import seedProducts from '../data/products.json'
import type { LeadPayload, Product } from '../types'

const CMS_URL = (import.meta.env.VITE_CMS_URL || 'http://localhost:1337').replace(/\/$/, '')

export async function getProducts(signal?: AbortSignal): Promise<{ products: Product[]; source: 'cms' | 'seed' }> {
  try {
    const response = await fetch(`${CMS_URL}/api/products?pagination[pageSize]=100&sort=outerDiameter:asc`, { signal })
    if (!response.ok) throw new Error(`CMS responded ${response.status}`)
    const payload = (await response.json()) as { data?: Product[] }
    if (!payload.data?.length) throw new Error('CMS returned an empty catalog')
    return { products: payload.data, source: 'cms' }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { products: seedProducts as Product[], source: 'seed' }
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
