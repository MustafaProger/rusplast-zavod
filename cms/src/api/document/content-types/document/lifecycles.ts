import { validatePdfRelation } from '../../../../utils/pdf-validation'

export default {
  async beforeCreate(event: any) {
    await validatePdfRelation(strapi, event.params.data.file)
  },
  async beforeUpdate(event: any) {
    await validatePdfRelation(strapi, event.params.data.file)
  },
}
