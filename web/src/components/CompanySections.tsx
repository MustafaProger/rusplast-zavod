import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useContent } from '../lib/content'
import { ArrowLeft, ArrowRight, Download, Maximize2, ZoomIn, ZoomOut, BadgeCheck, Boxes, Factory, PaintBucket, Truck, WalletCards } from 'lucide-react'

export function Production() {
  const { images } = useContent()
  const items = [
    [Boxes, 'Полный цикл производства', 'От подготовки сырья до готовой гофрированной трубы.'],
    [PaintBucket, 'Цвет под материал и задачу', 'ПВХ — преимущественно серый. ПНД — чёрный и оранжевый. Исполнение согласуем по вашему проекту.'],
    [BadgeCheck, 'Честные характеристики', 'Фактические показатели соответствуют данным на упаковке.'],
    [Factory, 'Производство под вашей СТМ', 'Нанесём вашу торговую марку, маркировку и подготовим упаковку.'],
  ] as const

  return (
    <section className="production" id="about">
      <div className="production-copy">
        <span className="eyebrow">ОТ СЫРЬЯ ДО ОТГРУЗКИ</span><h2>Качество.<br /><span>В наших руках.</span></h2>
        <p className="production-summary">РУСПЛАСТЗАВОД — российский производитель кабеленесущих систем. Выпускаем продукцию для прокладки и защиты кабелей в Раменском районе Московской области.</p>
        <div className="factory-facts"><div><strong>с 2021</strong><span>производим в России</span></div><div><strong>1 700+ м²</strong><span>производственных помещений</span></div><div><strong>3 линии</strong><span>экструзии гофротрубы</span></div></div>
        <div className="advantage-list">
          {items.map(([Icon, title, text]) => <div className="advantage" key={title}><Icon /><div><h3>{title}</h3><p>{text}</p></div></div>)}
        </div>
      </div>
      <div className="production-range" aria-label="Цвета гофрированной трубы">
        <span className="eyebrow">МАТЕРИАЛЫ И ЦВЕТА</span>
        <div className="production-product-list">
          <figure className="production-product">
            <img src={images['pipe-gray'] || '/images/pipe-gray.jpg'} alt="Бухта серой гофрированной трубы ПВХ с зондом" width="800" height="476" loading="lazy" decoding="async" />
            <figcaption><strong>ПВХ</strong><span>Основной цвет — серый.<br />Чёрный — по согласованию.</span></figcaption>
          </figure>
          <figure className="production-product">
            <img src={images['pipe-black'] || '/images/pipe-black.jpg'} alt="Бухта чёрной гофрированной трубы ПНД с зондом" width="800" height="476" loading="lazy" decoding="async" />
            <figcaption><strong>ПНД · чёрный</strong><span>Базовый цвет трубы<br />из полиэтилена.</span></figcaption>
          </figure>
          <figure className="production-product">
            <img src={images['pipe-orange-original'] || '/images/pipe-orange-original.jpg'} alt="Бухта оранжевой гофрированной трубы ПНД с зондом" width="300" height="179" loading="lazy" decoding="async" />
            <figcaption><strong>ПНД · оранжевый</strong><span>Для сигнализации и видеонаблюдения — по требованиям проекта.</span></figcaption>
          </figure>
        </div>
        <p className="production-color-note"><strong>FRHF под заказ</strong>Основной цвет — чёрный, также используется красный, реже — белый. Цвет, характеристики и документы согласуем для конкретного исполнения.</p>
      </div>
    </section>
  )
}

export function Delivery() {
  const steps = [
    ['01', 'Заявка и расчёт', 'Уточняем объём, характеристики, стоимость и сроки.'],
    ['02', 'Счёт и производство', 'После согласования запускаем заказ в производство.'],
    ['03', 'Согласованная отгрузка', 'Упаковываем продукцию и передаём на доставку в согласованный срок.'],
  ]
  return (
    <section className="delivery section" id="delivery">
      <span className="eyebrow">ПРОСТОЙ ПУТЬ К ВАШЕМУ ОБЪЕКТУ</span><h2>От заявки до поставки.<br /><span>Три понятных шага.</span></h2>
      <div className="steps">{steps.map(([num, title, text]) => <div className="step" key={num}><span>{num}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div>
      <div className="delivery-notes">
        <p><Truck />От 100 бухт — бесплатная доставка в пределах МКАД, кроме территории внутри ТТК, либо до транспортной компании. Условия заказа подтвердит менеджер.</p>
        <p><WalletCards />Безналичный расчёт для юридических лиц.</p>
      </div>
    </section>
  )
}

export function Certificates() {
  const { documents } = useContent()
  const [active, setActive] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(false)
  const slides = useRef<HTMLDivElement>(null)
  const activeDocument = active === null ? null : documents[active]
  const go = (index: number) => {
    setZoom(false)
    setPage(index)
    const container = slides.current
    if (container) container.scrollTo({ left: index * container.clientWidth, behavior: 'instant' })
  }
  useEffect(() => {
    if (active === null) return
    const container = slides.current
    const resize = () => { if (container) container.scrollLeft = page * container.clientWidth }
    resize()
    const observer = new ResizeObserver(resize)
    if (container) observer.observe(container)
    return () => observer.disconnect()
  }, [active, page])
  return <section className="certificates section" id="certificates" aria-labelledby="certificates-heading">
    <div className="section-heading"><h2 id="certificates-heading">Сертификаты и документы</h2></div>
    <div className="certificate-grid">
      {documents.map((doc, index) => <button className="certificate-card" key={doc.pdf} onClick={() => { setZoom(false); setPage(0); setActive(index) }} aria-label={`Открыть документ: ${doc.title}`}><div className="certificate-preview"><>{doc.pages.length ? <img src={doc.pages[0]} alt={doc.title} loading="lazy" width="724" height="1024" /> : <div className="pdf-preview"><strong>PDF</strong><span>{doc.title}</span></div>}</><span><Maximize2 size={18} /></span></div><div className="certificate-caption"><span><strong>{doc.title}</strong><small>{doc.subtitle}{doc.pages.length > 1 ? ` · ${doc.pages.length} ${doc.pages.length < 5 ? 'страницы' : 'страниц'}` : ''}</small></span><ArrowRight size={20} /></div></button>)}
    </div>
    <div className="documents-bottom"><p>Документы ООО «РУСПЛАСТЗАВОД». Нажмите на карточку, чтобы открыть скан или скачать оригинал PDF.</p></div>
    {activeDocument && <Modal className="document-modal" label={activeDocument.title} onClose={() => setActive(null)}>
      <div className="document-toolbar"><div><span className="eyebrow">СЕРТИФИКАТЫ И ДОКУМЕНТЫ</span><h3>{activeDocument.title}</h3></div><div>{activeDocument.pages.length > 0 && <button className="round-button" aria-label={zoom ? 'Уменьшить документ' : 'Увеличить документ'} onClick={() => setZoom(!zoom)}>{zoom ? <ZoomOut size={19} /> : <ZoomIn size={19} />}</button>}<a className="round-button" href={`/documents/${activeDocument.slug}.pdf`} download aria-label="Скачать оригинал PDF"><Download size={19} /></a></div></div>
      {activeDocument.pages.length ? <><div className={zoom ? 'document-slides is-zoomed' : 'document-slides'} ref={slides} tabIndex={0} aria-label="Страницы документа. Используйте стрелки влево и вправо" onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); go((page + (event.key === 'ArrowRight' ? 1 : activeDocument.pages.length - 1)) % activeDocument.pages.length) } }} onScroll={event => {
        const node = event.currentTarget
        const index = Math.round(node.scrollLeft / node.clientWidth)
        if (Math.abs(node.scrollLeft - index * node.clientWidth) < 2 && index !== page && index < activeDocument.pages.length) { setPage(index); setZoom(false) }
      }}>
        {activeDocument.pages.map((image, index) => <div key={image} className="document-slide" aria-hidden={index !== page}><img src={image} alt={`${activeDocument.title}, страница ${index + 1}`} loading={index === page ? 'eager' : 'lazy'} /></div>)}
      </div>
      <div className="document-controls"><button className="round-button" aria-label="Предыдущая страница" disabled={activeDocument.pages.length === 1} onClick={() => go((page + activeDocument.pages.length - 1) % activeDocument.pages.length)}><ArrowLeft size={20} /></button><span aria-live="polite">{page + 1} / {activeDocument.pages.length}</span><button className="round-button" aria-label="Следующая страница" disabled={activeDocument.pages.length === 1} onClick={() => go((page + 1) % activeDocument.pages.length)}><ArrowRight size={20} /></button></div></> : <div className="document-pdf"><object data={`/documents/${activeDocument.slug}.pdf`} type="application/pdf" aria-label={activeDocument.title}><p>Откройте PDF по ссылке ниже.</p></object><a className="button button-primary" href={`/documents/${activeDocument.slug}.pdf`} target="_blank" rel="noopener noreferrer">Открыть PDF <Download size={18} /></a></div>}
    </Modal>}
  </section>
}
