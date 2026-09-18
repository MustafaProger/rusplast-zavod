import { Check } from 'lucide-react'
import { Modal } from './Modal'
import type { Product } from '../types'
import { productDescription, productImage } from '../lib/product-presentation'

type ProductModalProps = {
  product: Product
  selected: boolean
  onToggleSelected: () => void
  onClose: () => void
}

export function ProductModal({ product, selected, onToggleSelected, onClose }: ProductModalProps) {
  const specs = [
    ['Артикул', product.sku], ['Материал', product.material], ['Класс нагрузки', product.loadClass],
    ['Диаметр', `внутр. ${product.innerDiameter} мм / внеш. ${product.outerDiameter} мм`],
    ['Сопротивление сжатию', product.compression], ['Степень защиты', product.protection],
    ['Температура', product.temperature], ['Длина бухты', `${product.coilLength} м`],
    ['Вес бухты', product.coilWeight], ['Климатическое исполнение', product.climate],
  ]

  return (
    <Modal className="product-modal" label={`${product.material}, ${product.loadClass}, ${product.outerDiameter} мм`} onClose={onClose}>
        <div className="modal-product-image"><img src={productImage(product)} alt={`${product.material} гофротруба ${product.color.toLowerCase()}`} width="800" height="476" /></div>
        <div className="modal-product-content">
          <span className="modal-sku">Арт. {product.sku}</span>
          <h2 id="product-title">{product.material} {product.loadClass.toLowerCase()} · Ø {product.outerDiameter} мм</h2>
          <p className="modal-description">{productDescription(product)}</p>
          <a className="editorial-link" href={product.material === 'ПВХ' ? '/catalog/pvh#certification' : '/catalog/pnd#documents'}>Документы и условия применения</a>
          <dl className="spec-list">{specs.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
          <div className="modal-footer">
            <strong>от {product.price.toFixed(2).replace('.', ',')} ₽/м</strong>
            <button className={selected ? 'button button-primary is-selected' : 'button button-primary'} onClick={onToggleSelected}>{selected && <Check size={18} />}{selected ? 'Добавлено в заявку' : 'Добавить в заявку'}</button>
          </div>
        </div>
    </Modal>
  )
}
