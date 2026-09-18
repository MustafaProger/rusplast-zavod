import { ArrowDown, ArrowRight, ArrowUpRight, Clock3 } from 'lucide-react'
import { articles, articlePath, readingMinutes, type Article, type ContentSection } from '../data/editorial'
import { landingPages, type LandingPage } from '../data/pages'
import type { ReactNode } from 'react'
import './Editorial.css'

export function EditorialImage({ name, alt, eager = false, className = '' }: { name: string; alt: string; eager?: boolean; className?: string }) {
  const wide = name === 'pipe-gray' || name === 'pipe-black'
  return <img className={className} src={`/images/optimized/${name}-1280.webp`} srcSet={`/images/optimized/${name}-640.webp 640w, /images/optimized/${name}-1280.webp ${wide ? 800 : 1280}w`} sizes="(max-width: 640px) 100vw, (max-width: 960px) 70vw, 800px" alt={alt} width={wide ? 800 : 1536} height={wide ? 476 : 1024} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} decoding={eager ? undefined : 'async'} />
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return <nav className="breadcrumbs" aria-label="Хлебные крошки"><ol><li><a href="/">Главная</a></li>{items.map((item, i) => <li key={i}>{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>
}

export function ContentSections({ sections }: { sections: ContentSection[] }) {
  return <>{sections.map(section => <section className="prose-section" key={section.id} id={section.id}>
    <h2>{section.title}</h2>
    {section.paragraphs.map(text => <p key={text}>{text}</p>)}
    {section.list && <ul>{section.list.map(text => <li key={text}>{text}</li>)}</ul>}
    {section.table && <div className="editorial-table" role="region" aria-label={section.table.caption} tabIndex={0}><table><caption>{section.table.caption}</caption><thead><tr>{section.table.headings.map(text => <th scope="col" key={text}>{text}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((text, j) => j === 0 ? <th scope="row" key={j}>{text}</th> : <td key={j}>{text}</td>)}</tr>)}</tbody></table></div>}
    {section.links && <div className="prose-links">{section.links.map(link => <a key={link.href} href={link.href}>{link.label}<ArrowUpRight size={16} /></a>)}</div>}
  </section>)}</>
}

function ArticleCard({ article }: { article: Article }) {
  return <article className="article-card">
    <a className="article-card-visual" href={articlePath(article)} tabIndex={-1} aria-hidden="true"><EditorialImage name={article.image} alt="" /><span className="article-visual-index">РПЗ / БЛОГ</span></a>
    <div className="article-card-copy"><div className="article-category">{article.category}<span>{readingMinutes(article)} мин</span></div><h2><a href={articlePath(article)}>{article.title}</a></h2><p>{article.description}</p><a className="editorial-link" href={articlePath(article)} aria-label={`Читать: ${article.title}`}>Читать статью <ArrowUpRight size={18} /></a></div>
  </article>
}

export function BlogPage() {
  return <main id="main-content" className="editorial-page">
    <div className="editorial-container"><Breadcrumbs items={[{ label: 'Блог' }]} />
      <header className="editorial-heading"><span className="eyebrow">БЛОГ РУСПЛАСТЗАВОДА</span><h1>Блог о гофротрубах.<br /><span>Всё дело в деталях.</span></h1><p>Гофротрубы, комплектующие и производство.<br className="desktop-break" /> Практические материалы для тех, кто выбирает и закупает.</p></header>
      <div className="blog-divider"><span>Все материалы</span><span>06 статей · от выбора до поставки</span></div>
      <div className="article-grid">{articles.map(article => <ArticleCard key={article.slug} article={article} />)}</div>
      <RequestCallout />
    </div>
  </main>
}

export function RelatedArticles({ slugs }: { slugs: string[] }) {
  return <section className="related-articles"><div className="related-heading"><h2>Продолжить чтение.</h2><a className="editorial-link" href="/blog">Весь блог <ArrowRight size={17} /></a></div><div className="article-grid">{slugs.map(slug => articles.find(article => article.slug === slug)).filter((article): article is Article => Boolean(article)).map(article => <ArticleCard article={article} key={article.slug} />)}</div></section>
}

export function ArticlePage({ article }: { article: Article }) {
  return <main id="main-content" className="editorial-page article-page"><div className="editorial-container">
    <Breadcrumbs items={[{ label: 'Блог', href: '/blog' }, { label: article.title }]} />
    <header className="article-header"><span className="eyebrow">{article.category}</span><h1>{article.title}</h1><p className="article-intro">{article.intro}</p><div className="article-meta"><span>По материалам РУСПЛАСТЗАВОДА</span><span><Clock3 size={15} /> {readingMinutes(article)} мин чтения</span><span>Подготовлено <time dateTime="2026-09-18">18 сентября 2026</time></span></div></header>
    <figure className="article-cover"><div className="article-cover-media"><EditorialImage name={article.image} alt={article.imageAlt} eager /></div><figcaption>Иллюстрация к материалу. Характеристики уточняйте по выбранному изделию.</figcaption></figure>
    <div className="article-layout"><aside className="article-toc"><nav aria-label="Содержание статьи"><span className="eyebrow">В ЭТОЙ СТАТЬЕ</span><ol>{article.sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol><a className="editorial-link" href="/catalog">Каталог продукции <ArrowUpRight size={16} /></a></nav></aside>
      <article className="article-body"><div className="article-takeaway"><span>Главное при выборе</span><p>{article.takeaway}</p></div><ContentSections sections={article.sections} />
        <section className="article-sources"><h2>Материалы и документы</h2><p>Материал подготовлен по сведениям о компании, таблице ассортимента и предоставленным документам. Данные для конкретной поставки подтверждаются в спецификации и паспорте изделия.</p><ul>{article.sources.map(link => <li key={link.href}><a href={link.href}>{link.label}<ArrowUpRight size={15} /></a></li>)}</ul></section>
      </article>
    </div><RequestCallout /><RelatedArticles slugs={article.related} />
  </div></main>
}

export function CategoryLinks({ active }: { active?: string }) {
  return <nav className="category-links" aria-label="Категории продукции"><a href="/catalog" aria-current={active === '/catalog' ? 'page' : undefined}>Все трубы</a>{landingPages.filter(page => page.path.startsWith('/catalog/')).map(page => <a key={page.path} href={page.path} aria-current={active === page.path ? 'page' : undefined}>{page.label}<ArrowUpRight size={14} /></a>)}</nav>
}

export function Landing({ page, children, onRequest }: { page: LandingPage; children?: ReactNode; onRequest: () => void }) {
  return <main id="main-content" className="editorial-page landing-page"><div className="editorial-container">
    <Breadcrumbs items={[...(page.path.startsWith('/catalog/') ? [{ label: 'Каталог', href: '/catalog' }] : []), { label: page.label }]} />
    <header className="landing-hero"><div><span className="eyebrow">{page.eyebrow}</span><h1>{page.title}</h1><p>{page.intro}</p><div className="landing-actions"><button className="button button-primary" onClick={onRequest}>Обсудить поставку <ArrowUpRight size={17} /></button>{page.material && <a className="editorial-link" href="#catalog">Выбрать трубу <ArrowDown size={17} /></a>}</div></div><EditorialImage name={page.image} alt={page.imageAlt} eager /></header>
    <CategoryLinks active={page.path} />
  </div>{children}<div className="editorial-container"><div className="landing-prose"><ContentSections sections={page.sections} /></div><RequestCallout onRequest={onRequest} /><RelatedArticles slugs={page.related} /></div></main>
}

export function RequestCallout({ onRequest }: { onRequest?: () => void }) {
  return <section className="editorial-cta" id="request"><div><span className="eyebrow">ОТ ВЫБОРА К ПОСТАВКЕ</span><h2>Обсудим вашу задачу.</h2><p>Уточним характеристики, комплектацию и объём.<br />Подготовим предложение на вашу поставку.</p></div>{onRequest ? <button className="button button-primary" onClick={onRequest}>Отправить запрос <ArrowUpRight size={17} /></button> : <a href="/#request" className="button button-primary">Обсудить поставку <ArrowUpRight size={17} /></a>}</section>
}

export function BlogPreview() {
  return <section className="section blog-preview"><div className="section-heading"><div><span className="eyebrow">БЛОГ РУСПЛАСТЗАВОДА</span><h2>Больше ясности.<br /><span>В каждой детали.</span></h2></div><a className="editorial-link" href="/blog">Все статьи <ArrowRight size={17} /></a></div><div className="article-grid">{articles.slice(0, 3).map(article => <ArticleCard key={article.slug} article={article} />)}</div></section>
}

export function NotFound() {
  return <main id="main-content" className="editorial-page"><div className="editorial-container not-found"><span className="eyebrow">404 · СТРАНИЦА НЕ НАЙДЕНА</span><h1>Кажется, здесь поворот.</h1><p>Проверьте адрес или продолжите знакомство с продукцией.</p><a href="/catalog" className="button button-primary">Перейти в каталог <ArrowRight size={18} /></a><a href="/blog" className="editorial-link">Почитать блог <ArrowUpRight size={17} /></a></div></main>
}
