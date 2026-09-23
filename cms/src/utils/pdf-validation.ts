import { open } from 'node:fs/promises'
import { errors } from '@strapi/utils'

type UploadedFile = { originalFilename?: string; name?: string; mimetype?: string; type?: string; filepath?: string; path?: string }

/** Validate the bytes as well as browser-controlled MIME and file extension. */
export async function validatePdfUpload(file: UploadedFile) {
  const name = file.originalFilename || file.name || ''
  const mime = file.mimetype || file.type || ''
  const hasPdfExtension = /\.pdf$/i.test(name)
  if (!hasPdfExtension && mime !== 'application/pdf') return
  if (!hasPdfExtension || mime !== 'application/pdf') {
    throw new errors.ValidationError('PDF должен иметь расширение .pdf и тип application/pdf.')
  }
  const filePath = file.filepath || file.path
  if (!filePath) throw new errors.ValidationError('Не удалось проверить содержимое PDF.')
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(8)
    await handle.read(header, 0, header.length, 0)
    if (!/^%PDF-\d\.\d/.test(header.toString('ascii'))) {
      throw new errors.ValidationError('Файл не является PDF: неверная сигнатура.')
    }
  } finally {
    await handle.close()
  }
}

export function relationIds(value: unknown): number[] {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return [value]
  if (typeof value === 'string' && /^\d+$/.test(value)) return [Number(value)]
  if (Array.isArray(value)) return value.flatMap(relationIds)
  if (!value || typeof value !== 'object') return []
  const relation = value as Record<string, unknown>
  return [...relationIds(relation.id), ...relationIds(relation.set), ...relationIds(relation.connect)]
}

export async function validatePdfRelation(strapi: any, value: unknown) {
  for (const id of relationIds(value)) {
    const file = await strapi.db.query('plugin::upload.file').findOne({ where: { id } })
    if (!file || file.mime !== 'application/pdf' || file.ext?.toLowerCase() !== '.pdf') {
      throw new errors.ValidationError('В поле «PDF» можно выбрать только файл PDF.')
    }
  }
}
