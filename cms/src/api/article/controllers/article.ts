import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::article.article', () => ({
  // Drafts remain in the authenticated Content Manager. Public query parameters
  // must not expose an editor's unpublished work.
  async find(ctx) {
    ctx.query = { ...ctx.query, status: 'published' }
    return super.find(ctx)
  },
  async findOne(ctx) {
    ctx.query = { ...ctx.query, status: 'published' }
    return super.findOne(ctx)
  },
}))
