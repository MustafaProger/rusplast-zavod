import { validatePdfUpload } from '../../utils/pdf-validation'
import { errors } from '@strapi/utils'

export default (plugin: any) => {
  const originalFactory = plugin.services.upload
  plugin.services.upload = (context: any) => {
    const service = originalFactory(context)
    const originalUpload = service.upload.bind(service)
    const originalReplace = service.replace.bind(service)
    service.upload = async (args: any, options: any) => {
      for (const file of Array.isArray(args.files) ? args.files : [args.files]) {
        await validatePdfUpload(file)
      }
      return originalUpload(args, options)
    }
    service.replace = async (id: number, args: any, options: any) => {
      const existing = await context.strapi.db.query('plugin::upload.file').findOne({ where: { id } })
      if (existing?.mime === 'application/pdf' && (args.file.mimetype || args.file.type) !== 'application/pdf') {
        throw new errors.ValidationError('PDF можно заменить только другим PDF.')
      }
      await validatePdfUpload(args.file)
      return originalReplace(id, args, options)
    }
    return service
  }
  return plugin
}
