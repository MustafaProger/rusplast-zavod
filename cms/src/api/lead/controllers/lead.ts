import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::lead.lead', ({ strapi }) => ({
  async create(ctx) {
    const data = ctx.request.body?.data
    if (!data || data.consent !== true || data.consentVersion !== '2026-09-05') return ctx.badRequest('Необходимо согласие на обработку персональных данных.')
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.phone !== 'string' || data.phone.replace(/\D/g, '').length < 10 || data.phone.replace(/\D/g, '').length > 15 || data.phone.length > 25) return ctx.badRequest('Проверьте имя и телефон.')
    if (typeof data.email !== 'string' || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return ctx.badRequest('Проверьте email.')
    if (data.comment != null && (typeof data.comment !== 'string' || data.comment.length > 3000)) return ctx.badRequest('Комментарий слишком длинный.')
    if (!Array.isArray(data.products) || data.products.length > 100 || data.products.some((item: { sku?: unknown; quantity: number } | null) => !item || typeof item.sku !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999)) return ctx.badRequest('Проверьте товары в заявке.')
    ctx.request.body = { data: { name: data.name.trim(), phone: data.phone.trim(), email: data.email.trim(), comment: data.comment || '', products: data.products, consent: true, consentVersion: '2026-09-05', consentedAt: new Date().toISOString(), status: 'Новая' } }
    const result = await super.create(ctx)
    try {
      await strapi.service('api::lead.notification').send({ ...ctx.request.body.data, documentId: result.data.documentId })
    } catch {
      // The request is already saved: do not invite a duplicate submission.
      strapi.log.error(`Lead ${result.data.documentId}: notification status could not be updated`)
    }
    return result
  },
}))
