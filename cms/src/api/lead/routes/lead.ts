import { factories } from '@strapi/strapi'

// Staff use the authenticated CMS content manager. Even an accidental public
// permission change must never expose saved customer contacts over Content API.
export default factories.createCoreRouter('api::lead.lead', { only: ['create'] })
