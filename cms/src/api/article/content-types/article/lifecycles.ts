import { errors } from '@strapi/utils'

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function links(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => {
    if (!item || typeof item.label !== 'string' || typeof item.href !== 'string' || /[\\\u0000-\u0020]/.test(item.href)) return false
    if (/^\/(?!\/)/.test(item.href)) return true
    try { return ['http:', 'https:'].includes(new URL(item.href).protocol) } catch { return false }
  })
}

export function validateArticleContent(data: Record<string, unknown>) {
  const sectionIds = new Set<string>()
  if (data.sections !== undefined && (!Array.isArray(data.sections) || !data.sections.every(section => {
    if (!section || typeof section.id !== 'string' || !section.id.trim() || sectionIds.has(section.id) || typeof section.title !== 'string' || !strings(section.paragraphs)) return false
    sectionIds.add(section.id)
    if (section.list !== undefined && !strings(section.list)) return false
    if (section.links !== undefined && !links(section.links)) return false
    if (section.table !== undefined && (!section.table || typeof section.table.caption !== 'string' || !strings(section.table.headings) || !Array.isArray(section.table.rows) || !section.table.rows.every(strings))) return false
    return true
  }))) throw new errors.ValidationError('Разделы статьи должны содержать id, title и paragraphs (массив строк). Проверьте также списки, ссылки и таблицы.')
  if (data.sources !== undefined && !links(data.sources)) throw new errors.ValidationError('Источники должны быть массивом ссылок {label, href}, href начинается с /, http:// или https://.')
  if (data.related !== undefined && !strings(data.related)) throw new errors.ValidationError('Связанные статьи должны быть массивом строк slug.')
}

export default {
  beforeCreate(event: any) { validateArticleContent(event.params.data) },
  beforeUpdate(event: any) { validateArticleContent(event.params.data) },
}
