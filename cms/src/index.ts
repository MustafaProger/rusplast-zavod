import type { Core } from '@strapi/strapi'
import products from './data/products.json'

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const productService = strapi.documents('api::product.product')
    const existing = await productService.findMany({ limit: 1 })

    if (existing.length === 0) {
      for (const product of products) {
        if ((product.material !== 'ПВХ' && product.material !== 'ПНД') || (product.loadClass !== 'Легкая' && product.loadClass !== 'Тяжелая')) throw new Error('Invalid seed product classification')
        await productService.create({ data: { ...product, material: product.material, loadClass: product.loadClass }, status: 'published' })
      }
      strapi.log.info(`Seeded ${products.length} products from the supplied Excel catalog`)
    }

    const roleQuery = strapi.db.query('plugin::users-permissions.role')
    const permissionQuery = strapi.db.query('plugin::users-permissions.permission')
    const publicRole = await roleQuery.findOne({ where: { type: 'public' } })

    if (!publicRole) return

    const actions = [
      'api::product.product.find',
      'api::product.product.findOne',
      'api::lead.lead.create',
    ]

    for (const action of actions) {
      const permission = await permissionQuery.findOne({ where: { action, role: publicRole.id } })
      if (!permission) {
        await permissionQuery.create({ data: { action, role: publicRole.id, enabled: true } })
      } else if (!permission.enabled) {
        await permissionQuery.update({ where: { id: permission.id }, data: { enabled: true } })
      }
    }
  },
}
