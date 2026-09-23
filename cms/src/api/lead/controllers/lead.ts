import { factories } from '@strapi/strapi'
import { CONSENT_VERSION, consentEvidence } from '../legal/evidence'

type SubmittedProduct = { sku: string; quantity: number }

export default factories.createCoreController('api::lead.lead', ({ strapi }) => ({
  async create(ctx) {
    const data = ctx.request.body?.data
    if (!data || data.consent !== true || data.consentVersion !== CONSENT_VERSION) return ctx.badRequest('Необходимо отдельное согласие актуальной редакции. Обновите страницу и подтвердите согласие.')
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.phone !== 'string' || data.phone.replace(/\D/g, '').length < 10 || data.phone.replace(/\D/g, '').length > 15 || data.phone.length > 25) return ctx.badRequest('Проверьте имя и телефон.')
    if (typeof data.email !== 'string' || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) return ctx.badRequest('Проверьте email.')
    if (data.comment != null && (typeof data.comment !== 'string' || data.comment.length > 3000)) return ctx.badRequest('Комментарий слишком длинный.')
    if (!Array.isArray(data.products) || data.products.length > 100 || data.products.some((item: SubmittedProduct | null) => !item || typeof item.sku !== 'string' || !item.sku.trim() || item.sku.length > 80 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999)) return ctx.badRequest('Проверьте товары в заявке.')
    const selected = data.products as SubmittedProduct[]
    if (new Set(selected.map(item => item.sku)).size !== selected.length) return ctx.badRequest('Товар не должен повторяться в заявке.')
    const catalog = selected.length ? await strapi.documents('api::product.product').findMany({
      filters: { sku: { $in: selected.map(item => item.sku) } }, status: 'published', limit: 100,
    }) : []
    const bySku = new Map(catalog.map(product => [product.sku, product]))
    if (selected.some(item => !bySku.has(item.sku))) return ctx.badRequest('Состав каталога изменился. Обновите страницу и проверьте заявку.')
    // Only SKU and quantity come from the submitted JSON; arbitrary nested
    // fields, external image URLs and client-controlled prices are not retained.
    if (catalog.some(product => typeof product.coilLength !== 'number' || !Number.isFinite(product.coilLength) || product.coilLength <= 0 || typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0)) return ctx.badRequest('Параметры товара требуют уточнения. Свяжитесь с менеджером.')
    const products = selected.map(({ sku, quantity }) => {
      const product = bySku.get(sku)!
      return { sku, quantity, name: product.name || sku, material: product.material || '', diameter: product.outerDiameter ?? null, coilLength: product.coilLength!, meters: product.coilLength! * quantity, pricePerMeter: product.price! }
    })
    const leadData = {
      name: data.name.trim(), phone: data.phone.trim(), email: data.email.trim(),
      comment: data.comment?.trim() || '', products,
      ...consentEvidence(), status: 'Новая' as const,
    }
    // Deliberately ignore client IDs, status, consent timestamps/text, retention,
    // populate and query projections. The server controls the saved evidence.
    const result = await strapi.documents('api::lead.lead').create({ data: leadData })
    try {
      await strapi.service('api::lead.notification').send({ ...leadData, documentId: result.documentId })
    } catch {
      // The request is already saved: do not invite a duplicate submission.
      strapi.log.error(`Lead ${result.documentId}: notification status could not be updated`)
    }
    ctx.status = 201
    // Do not echo contacts, comment or consent evidence through the public API.
    return { data: { documentId: result.documentId }, meta: {} }
  },
}))
