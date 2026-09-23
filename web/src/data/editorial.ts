import snapshot from './cms-snapshot.json'

export type ContentLink = { label: string; href: string }
export type ContentSection = {
  id: string
  title: string
  paragraphs: string[]
  list?: string[]
  table?: { caption: string; headings: string[]; rows: string[][] }
  links?: ContentLink[]
}
export type Article = {
  publishedAt?: string
  modifiedAt?: string
  author?: string
  slug: string
  title: string
  seoTitle: string
  description: string
  category: string
  image: string
  imageAlt: string
  intro: string
  takeaway: string
  sections: ContentSection[]
  sources: ContentLink[]
  related: string[]
}

export const articles = snapshot.articles as Article[]

export function articlePath(article: Article) { return `/blog/${article.slug}` }
export function readingMinutes(article: Article) {
  const text = [article.intro, ...article.sections.flatMap(section => [section.title, ...section.paragraphs, ...(section.list || []), ...(section.table?.rows.flat() || [])])].join(' ')
  return Math.max(1, Math.ceil(text.split(/\s+/).length / 180))
}
