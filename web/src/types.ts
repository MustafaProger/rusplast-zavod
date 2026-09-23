export type Material = 'ПВХ' | 'ПНД'
export type LoadClass = 'Легкая' | 'Тяжелая'

export type Product = {
  id?: number
  documentId?: string
  name: string
  slug: string
  sku: string
  material: Material
  loadClass: LoadClass
  description: string
  packageType: string
  temperature: string
  combustibility: string
  halogenFree: boolean
  uvResistant: boolean
  frostResistant: boolean
  concretePour: boolean
  protection: string
  color: string
  innerDiameter: number | null
  outerDiameter: number | null
  bendRadius: number | null
  climate: string
  coilWeight: string
  coilLength: number
  packageLength: number | null
  packageWidth: number | null
  packageHeight: number | null
  compression: string
  price: number
  image: string
  imageThumbnail?: string
  featured: boolean
}

export type CartItem = { product: Product; quantity: number }

export type LeadPayload = {
  name: string
  phone: string
  email: string
  comment: string
  products: { sku: string; name: string; image: string; material: string; diameter: number | null; quantity: number; coilLength: number; meters: number; pricePerMeter: number }[]
  consent: boolean
  consentVersion: string
}
