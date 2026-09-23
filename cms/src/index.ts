import type { Core } from '@strapi/strapi'

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Content is imported explicitly by scripts/migrate-content.cjs. Restarting
    // the CMS must never recreate records an editor intentionally deleted.
    const roleQuery = strapi.db.query('plugin::users-permissions.role')
    const permissionQuery = strapi.db.query('plugin::users-permissions.permission')
    const publicRole = await roleQuery.findOne({ where: { type: 'public' } })

    if (!publicRole) return

    const actions = [
      'api::product.product.find',
      'api::product.product.findOne',
      'api::article.article.find',
      'api::article.article.findOne',
      'api::document.document.find',
      'api::document.document.findOne',
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
