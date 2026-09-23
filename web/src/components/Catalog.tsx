import { ArrowLeft, ArrowRight, Check, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LoadClass, Material, Product } from '../types'
import { productImage } from '../lib/product-presentation'
import { sortCatalogProducts } from '../lib/catalog-order'

type CatalogProps = {
  products: Product[]
  selected: string[]
  onToggleSelected: (sku: string) => void
  onOpenProduct: (product: Product) => void
  showAll?: boolean
}

const PAGE_SIZE = 6

function money(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function Catalog({ products, selected, onToggleSelected, onOpenProduct, showAll = false }: CatalogProps) {
  const [query, setQuery] = useState('')
  const [material, setMaterial] = useState<'Все' | Material>('Все')
  const [loadClass, setLoadClass] = useState<'Все' | LoadClass>('Все')
  const [diameter, setDiameter] = useState<'Все' | number>('Все')
  const [color, setColor] = useState('Все')
  const [requestedPage, setPage] = useState(1)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const orderedProducts = useMemo(() => sortCatalogProducts(products), [products])

  const filtered = useMemo(() => orderedProducts.filter(product => {
    const normalizedQuery = query.toLowerCase().trim()
    const searchMatches = !normalizedQuery || product.name.toLowerCase().includes(normalizedQuery) || product.sku.toLowerCase().includes(normalizedQuery)
    return searchMatches
      && (material === 'Все' || product.material === material)
      && (loadClass === 'Все' || product.loadClass === loadClass)
      && (diameter === 'Все' || product.outerDiameter === diameter)
      && (color === 'Все' || product.color === color)
  }), [orderedProducts, query, material, loadClass, diameter, color])

  const pageSize = showAll ? Math.max(1, products.length) : PAGE_SIZE
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(requestedPage, pages)
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)


  return (
    <section className="catalog section" id="catalog">
      <div className="section-heading catalog-heading">
        <div><span className="eyebrow">НАЙДИТЕ СВОЮ ТРУБУ</span><h2>Правильный выбор.<br /><span>Для вашей задачи.</span></h2><p>{products.length} позиций в каталоге. Цена указана за метр; стоимость и наличие подтвердит менеджер.</p></div>
        <button className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={18} /> Фильтры</button>
      </div>

      <div className={filtersOpen ? 'catalog-filters is-open' : 'catalog-filters'}>
        <label className="search-field"><Search size={20} aria-hidden="true" /><input aria-label="Поиск по артикулу или названию" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="Артикул или название" /></label>
        <FilterGroup label="Материал" options={['Все', ...new Set(orderedProducts.map(product => product.material))]} value={material} onChange={value => { setMaterial(value as 'Все' | Material); setPage(1) }} />
        <FilterGroup label="Нагрузка" options={['Все', ...new Set(orderedProducts.map(product => product.loadClass))]} value={loadClass} onChange={value => { setLoadClass(value as 'Все' | LoadClass); setPage(1) }} />
        <FilterGroup label="Диаметр" options={['Все', ...[...new Set(products.map(product => product.outerDiameter).filter((value): value is number => value != null))].sort((a, b) => a - b).map(String)]} value={String(diameter)} onChange={value => { setDiameter(value === 'Все' ? 'Все' : Number(value)); setPage(1) }} suffix="мм" />
        <FilterGroup label="Цвет" options={['Все', ...new Set(orderedProducts.map(product => product.color))]} value={color} onChange={value => { setColor(value); setPage(1) }} />
      </div>

      <div className="catalog-table" role="region" aria-live="polite" aria-label="Товары">
        <div className="catalog-table-head" aria-hidden="true">
          <span>Труба</span><span>Материал · Нагрузка</span><span>Диаметр</span><span>Артикул</span><span>Длина бухты</span><span>Сжатие</span><span>Цена за метр</span><span>Действия</span>
        </div>
        {visible.map(product => {
          const isSelected = selected.includes(product.sku)
          return (
            <article className="product-row" key={product.sku}>
              <button className="product-image" onClick={() => onOpenProduct(product)} aria-label={`Подробнее: ${product.material}, ${product.loadClass}, ${product.outerDiameter} мм, артикул ${product.sku}`}><img loading="lazy" decoding="async" src={productImage(product)} alt={`${product.material} гофротруба ${product.color.toLowerCase()}, ${product.outerDiameter} мм, артикул ${product.sku}`} width="360" height="240" /></button>
              <div className="product-kind"><span className={`material-dot ${product.color.toLowerCase()}`} />{product.material} · {product.loadClass}</div>
              <strong className="product-diameter">Ø {product.outerDiameter} <small>мм</small></strong>
              <span className="product-sku">Арт. {product.sku}</span>
              <span><b className="mobile-label">Длина</b>{product.coilLength} м</span>
              <span><b className="mobile-label">Сжатие</b>{product.compression}</span>
              <strong className="product-price"><small>от</small> {money(product.price)} ₽<small>/м</small></strong>
              <div className="product-actions">
                <button className="details-link" onClick={() => onOpenProduct(product)}>Подробнее <ArrowRight size={16} /></button>
                <button className={isSelected ? 'request-button is-selected' : 'request-button'} onClick={() => onToggleSelected(product.sku)}>{isSelected ? <><Check size={15} /> Добавлено</> : 'В заявку'}</button>
              </div>
            </article>
          )
        })}
        {!visible.length && <div className="empty-state"><strong>Таких труб пока нет в выборке</strong><span>Сбросьте часть фильтров или отправьте запрос на индивидуальное производство.</span></div>}
      </div>

      <div className="catalog-footer">
        <span>Показано {visible.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} из {filtered.length} позиций</span>
        {!showAll && <div className="pagination">
          <button aria-label="Предыдущая страница" disabled={page === 1} onClick={() => setPage(page - 1)}><ArrowLeft size={18} /></button>
          {Array.from({ length: pages }, (_, index) => index + 1).map(number => <button key={number} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}
          <button aria-label="Следующая страница" disabled={page === pages} onClick={() => setPage(page + 1)}><ArrowRight size={18} /></button>
        </div>}
      </div>
    </section>
  )
}

function FilterGroup({ label, options, value, suffix, onChange }: { label: string; options: string[]; value: string; suffix?: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="filter-group">
      <legend>{label}</legend>
      <div>{options.map(option => <button key={option} type="button" aria-pressed={value === option} className={value === option ? 'active' : ''} onClick={() => onChange(option)}>{option}{suffix && option !== 'Все' && option === options.at(-1) ? ` ${suffix}` : ''}</button>)}</div>
    </fieldset>
  )
}
