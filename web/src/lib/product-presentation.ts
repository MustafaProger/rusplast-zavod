import seedProducts from '../data/products.json'
import type { Product } from '../types'

export function productImage(product: Product) {
  const name = ({ '/images/pipe-gray.jpg': 'pipe-gray', '/images/pipe-black.jpg': 'pipe-black', '/images/pipe-orange.png': 'pipe-orange' } as Record<string, string>)[product.image]
  return name ? `/images/optimized/${name}-640.webp` : product.image
}

export function productDescription(product: Product) {
  // Correct unsupported absolute claims in the original spreadsheet text only.
  // A subsequently edited CMS description retains editorial ownership.
  const original = seedProducts.find(item => item.sku === product.sku)
  if (!original || original.description !== product.description) return product.description
  if (product.material === 'ПНД') return 'Гибкая гофрированная труба ПНД для прокладки изолированных проводов и кабелей. Материал горючий; безгалогенность не означает негорючесть. Условия применения, стойкость к УФ и температурные требования уточняются по паспорту выбранного исполнения. Заливка бетоном для этой позиции не заявлена.'
  return `Гибкая гофрированная труба ПВХ для прокладки кабелей и проводов. ${product.concretePour ? 'Для этого тяжёлого исполнения в таблице продукции заявлена возможность заливки бетоном.' : 'Для этого лёгкого исполнения заливка бетоном в таблице характеристик не заявлена.'} Показатели пожарной безопасности приведены в сертификате ПВХ и его приложении. Трубу подбирают по условиям проекта; она не заменяет защитные устройства электрической сети.`
}
