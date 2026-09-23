import type { Product } from '../types'

type CatalogAttributes = Pick<Product, 'material' | 'loadClass' | 'color' | 'outerDiameter' | 'sku'>

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
const materials = ['пвх', 'пнд', 'frhf']
const loadClasses = ['легкая', 'тяжелая']
const colors: Record<string, string[]> = {
  пвх: ['серый', 'черный'],
  пнд: ['черный', 'оранжевый'],
  frhf: ['черный', 'красный', 'белый'],
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е')
}

function compareAttribute(left: string, right: string, preferred: string[]) {
  const a = normalize(left)
  const b = normalize(right)
  const aRank = preferred.indexOf(a)
  const bRank = preferred.indexOf(b)
  return (aRank < 0 ? preferred.length : aRank) - (bRank < 0 ? preferred.length : bRank)
    || collator.compare(a, b)
}

// Series stay together; new diameters and SKUs join their series automatically.
// Unknown attribute values form deterministic groups after the known ones.
export function compareCatalogProducts(left: CatalogAttributes, right: CatalogAttributes) {
  return compareAttribute(left.material, right.material, materials)
    || compareAttribute(left.loadClass, right.loadClass, loadClasses)
    || compareAttribute(left.color, right.color, colors[normalize(left.material)] || [])
    || (left.outerDiameter ?? Number.MAX_SAFE_INTEGER) - (right.outerDiameter ?? Number.MAX_SAFE_INTEGER)
    || collator.compare(left.sku, right.sku)
}

export function sortCatalogProducts<T extends CatalogAttributes>(products: readonly T[]): T[] {
  return [...products].sort(compareCatalogProducts)
}
