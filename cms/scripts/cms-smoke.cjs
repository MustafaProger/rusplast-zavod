const { compileStrapi, createStrapi } = require('@strapi/strapi')

const TEST_SKU = 'E2E-9000'
const cleanup = process.argv.includes('--cleanup')

async function main() {
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  const products = app.documents('api::product.product')

  try {
    const matches = await products.findMany({ filters: { sku: TEST_SKU }, status: 'published' })
    if (cleanup) {
      for (const product of matches) await products.delete({ documentId: product.documentId })
      console.log(`Removed ${matches.length} temporary CMS product(s)`)

      const leads = app.documents('api::lead.lead')
      const testLeads = await leads.findMany({ filters: { email: { $in: ['qa@example.com', 'test@example.com'] } } })
      for (const lead of testLeads) await leads.delete({ documentId: lead.documentId })
      console.log(`Removed ${testLeads.length} temporary lead(s)`)
    } else if (matches.length === 0) {
      const created = await products.create({
        status: 'published',
        data: {
          name: 'Тестовая труба CMS Ø40 мм', slug: 'testovaya-truba-cms-e2e-9000', sku: TEST_SKU,
          material: 'ПНД', loadClass: 'Тяжелая',
          description: 'Временная позиция для проверки добавления товара через Strapi CMS.',
          packageType: 'Стрейч пленка', temperature: 'от -55 до +90', combustibility: 'Горючий',
          halogenFree: true, uvResistant: true, frostResistant: true, concretePour: true,
          protection: 'IP55', color: 'Черный', innerDiameter: 31, outerDiameter: 40, bendRadius: 120,
          climate: 'УХЛ1', coilWeight: '8 кг', coilLength: 50, packageLength: 70, packageWidth: 70,
          packageHeight: 28, compression: '750 Н', price: 39.9, image: '/images/pipe-black.jpg', featured: false
        }
      })
      console.log(`Created temporary CMS product ${created.documentId} (${TEST_SKU})`)
    } else {
      console.log(`Temporary CMS product already exists (${TEST_SKU})`)
    }
  } finally {
    await app.destroy()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
