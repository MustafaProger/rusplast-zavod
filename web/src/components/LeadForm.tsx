import { ArrowUpRight, CheckCircle2, Loader2, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { createLead } from '../lib/api'
import type { CartItem } from '../types'
import { Modal } from './Modal'
import { LEGAL_VERSION, LegalContent, type LegalKind } from './Legal'
import { productImage } from '../lib/product-presentation'

type LeadFormProps = {
  items?: CartItem[]
  mode?: 'band' | 'modal'
  onClose?: () => void
  onQuantity?: (sku: string, quantity: number) => void
}
const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
const subscribeToHydration = () => () => {}

export function LeadForm({ items = [], mode = 'band', onClose, onQuantity }: LeadFormProps) {
  const interactive = useSyncExternalStore(subscribeToHydration, () => true, () => false)
  const [sending, setSending] = useState(false)
  const submitting = useRef(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [legal, setLegal] = useState<LegalKind | null>(null)
  const [submittedItems, setSubmittedItems] = useState<CartItem[]>([])
  const total = items.reduce((sum, { product, quantity }) => sum + product.price * product.coilLength * quantity, 0)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = new FormData(event.currentTarget)
    const phone = String(form.get('phone') || '').trim()
    if (phone.replace(/\D/g, '').length < 10 || phone.replace(/\D/g, '').length > 15) { setError('Проверьте телефон: укажите от 10 до 15 цифр с кодом страны.'); return }
    if (!String(form.get('name') || '').trim()) { setError('Укажите ваше имя.'); return }
    if (form.get('consent') !== 'on') { setError('Подтвердите согласие на обработку персональных данных.'); return }
    submitting.current = true
    setSending(true)
    setError('')
    try {
      await createLead({
        name: String(form.get('name')).trim(), phone, email: String(form.get('email') || '').trim(),
        comment: String(form.get('comment') || '').trim(),
        products: items.map(({ product, quantity }) => ({ sku: product.sku, name: product.name, image: productImage(product, 'detail'), material: product.material, diameter: product.outerDiameter, quantity, coilLength: product.coilLength, meters: product.coilLength * quantity, pricePerMeter: product.price })),
        consent: true, consentVersion: LEGAL_VERSION,
      })
      setSubmittedItems(items)
      setSent(true)
    } catch { setError('Не удалось отправить заявку. Данные остались в форме — попробуйте ещё раз или позвоните +7 (966) 007-05-01.') }
    finally { submitting.current = false; setSending(false) }
  }
  const legalLink = (kind: LegalKind, text: string) => <a href={`/${kind}`} onClick={event => { event.preventDefault(); setLegal(kind) }}>{text}</a>
  const content = sent ? <div className="form-success" role="status">
    <CheckCircle2 /><span className="eyebrow">СПАСИБО ЗА ОБРАЩЕНИЕ</span><strong>Заявка принята.</strong><p>Менеджер свяжется с вами в рабочее время, чтобы согласовать детали.</p>
    {submittedItems.length > 0 && <ul className="submitted-items">{submittedItems.map(({ product, quantity }) => <li key={product.sku}>{product.material} · Ø {product.outerDiameter} мм · арт. {product.sku}<b>{quantity} бухт · {quantity * product.coilLength} м</b></li>)}</ul>}
    {onClose && <button className="button button-primary" onClick={onClose}>Готово</button>}
  </div> : <div className="request-layout">
    <aside className="request-summary">
      <span className="eyebrow">ВАША ПОСТАВКА</span><h3>{items.length ? 'Всё выбранное. Здесь.' : 'Начнём с вашего проекта.'}</h3>
      {items.length ? <>
        <ul className="selected-products">{items.map(({ product, quantity }) => <li key={product.sku}>
          <img src={productImage(product)} alt={`${product.material}, ${product.color}, артикул ${product.sku}`} width="360" height="240" />
          <div className="selected-product-info"><strong>{product.material} {product.loadClass.toLowerCase()} · Ø {product.outerDiameter} мм</strong><span>Арт. {product.sku} · {product.coilLength} м / бухта · {product.color}</span>
            <div className="quantity-row"><div className="quantity-control"><button type="button" aria-label={`Уменьшить количество ${product.sku}`} disabled={sending || quantity <= 1} onClick={() => onQuantity?.(product.sku, quantity - 1)}><Minus size={14} /></button><input aria-label={`Количество бухт ${product.sku}`} type="number" min="1" max="9999" value={quantity} disabled={sending} onChange={event => onQuantity?.(product.sku, Math.max(1, Math.min(9999, Math.floor(Number(event.target.value) || 1))))} /><button type="button" aria-label={`Увеличить количество ${product.sku}`} disabled={sending || quantity >= 9999} onClick={() => onQuantity?.(product.sku, quantity + 1)}><Plus size={14} /></button></div><small>бухт · {quantity * product.coilLength} м</small></div>
          </div>
          <button className="remove-product" type="button" aria-label={`Удалить ${product.sku}`} disabled={sending} onClick={() => onQuantity?.(product.sku, 0)}><Trash2 size={16} /></button>
        </li>)}</ul>
        <div className="request-total"><span>Предварительно, от</span><strong>{money(total)} ₽</strong></div><p className="request-note">Без учёта доставки. Итоговую стоимость и минимальную партию уточнит менеджер.</p>
      </> : <div className="request-empty"><ShoppingBag size={36} strokeWidth={1.2} /><p>Выберите трубы в каталоге или опишите задачу. Поможем с характеристиками и объёмом.</p><a href="/catalog" className="hero-link" onClick={onClose}>Перейти в каталог <ArrowUpRight size={16} /></a></div>}
      <div className="request-help"><span>Удобнее обсудить голосом?</span><a href="tel:+79660070501">+7 (966) 007-05-01</a></div>
    </aside>
    <form className="lead-form" method="post" onSubmit={onSubmit}>
      <div className="form-heading"><span className="eyebrow">КОНТАКТНЫЕ ДАННЫЕ</span><h3>Куда отправить расчёт?</h3><p>Уточним детали и подготовим предложение.</p></div>
      <label><span>Ваше имя</span><input name="name" autoComplete="name" placeholder="Как к вам обращаться" required maxLength={100} disabled={sending} /></label>
      <label><span>Телефон</span><input name="phone" type="tel" autoComplete="tel" placeholder="+7 (999) 123-45-67" required maxLength={25} disabled={sending} /></label>
      <label className="full-field"><span>Электронная почта</span><input name="email" type="email" autoComplete="email" placeholder="name@company.ru" required maxLength={254} disabled={sending} /></label>
      <label className="comment-field"><span>Комментарий <small>необязательно</small></span><textarea name="comment" placeholder="Объём, город доставки или особые требования" maxLength={3000} disabled={sending} /></label>
      <label className="consent"><input type="checkbox" name="consent" required disabled={sending} /><span>Даю {legalLink('consent', 'согласие на обработку персональных данных')}.</span></label>
      <p className="form-policy">{legalLink('privacy', 'Политика конфиденциальности')} · {legalLink('terms', 'Пользовательское соглашение')}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={sending || !interactive}>{sending ? <><Loader2 className="spin" size={18} /> Отправляем заявку</> : <>Отправить заявку <ArrowUpRight size={18} /></>}</button>
      <noscript><p className="form-footnote">Для отправки формы включите JavaScript или позвоните <a href="tel:+79660070501">+7 (966) 007-05-01</a>.</p></noscript>
      <p className="form-footnote">Без оплаты на сайте. Сначала согласуем все условия.</p>
    </form>
  </div>
  return <>
    {mode === 'modal' ? <Modal className="request-modal" label="Рассчитать поставку" onClose={() => { if (!submitting.current) onClose?.() }}><div className="request-title"><span className="eyebrow">НАПРЯМУЮ С ЗАВОДА</span><h2>Ваша следующая поставка.</h2></div>{content}</Modal> : content}
    {legal && <Modal className="legal-modal" label="Правовая информация" onClose={() => setLegal(null)}><LegalContent kind={legal} /></Modal>}
  </>
}
export function ContactSection({ items, onQuantity }: Pick<LeadFormProps, 'items' | 'onQuantity'>) {
  return <>
    <section className="contact-cta" id="request"><div className="contact-intro"><span className="eyebrow">ДАВАЙТЕ ОБСУДИМ ВАШ ПРОЕКТ</span><h2>Хорошая поставка<br /><span>начинается с диалога.</span></h2><p>Стандартная партия или особые характеристики.<br />Подготовим решение под вашу задачу.</p></div><LeadForm items={items} onQuantity={onQuantity} /></section>
    <section className="contacts section" id="contacts"><span className="eyebrow">ВСЕГДА НА СВЯЗИ</span><h2>Прямой контакт.</h2><div className="contact-grid"><div><span>Отдел продаж · Пн–Пт, 10:00–18:00</span><a className="contact-phone" href="tel:+79660070501">+7 (966) 007-05-01</a><a href="mailto:rusplastzavod@gmail.com">rusplastzavod@gmail.com</a></div><address>Московская область,<br />Раменский район, пос. Рылеево, 608/1</address></div><div className="legal-line">ООО «РУСПЛАСТЗАВОД» · ИНН 9721122788 · ОГРН 1217700129602</div></section>
  </>
}
