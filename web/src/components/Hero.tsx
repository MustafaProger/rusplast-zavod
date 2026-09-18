import { ArrowUpRight } from 'lucide-react'

type HeroProps = { onOpenRequest: () => void }
export function Hero({ onOpenRequest }: HeroProps) {
  return <>
    <section className="hero" id="top">
      <div className="hero-copy">
        <span className="eyebrow">РУСПЛАСТЗАВОД · СОБСТВЕННОЕ ПРОИЗВОДСТВО</span>
        <h1>Гофрированные трубы.<br /><span>От нашего завода.</span></h1>
        <p>Гофрированные трубы ПВХ и ПНД для защиты кабеля.<br className="desktop-break" /> От нашего завода — к вашему проекту.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="/catalog">Выбрать продукцию <ArrowUpRight size={17} /></a>
          <button className="hero-link" onClick={onOpenRequest}>Рассчитать поставку <ArrowUpRight size={18} /></button>
        </div>
      </div>
      <div className="hero-media"><img src="/images/optimized/hero-pipes-1280.webp" srcSet="/images/optimized/hero-pipes-640.webp 640w, /images/optimized/hero-pipes-1280.webp 1280w" sizes="(max-width: 640px) 100vw, 800px" alt="Бухты чёрной, серой и оранжевой гофрированной трубы" fetchPriority="high" width="1536" height="1024" /></div>
      <div className="hero-caption"><span className="status-dot" />ПВХ и ПНД. Цвет и характеристики под ваш проект.</div>
    </section>
    <section className="proof-rail" aria-label="Ключевые условия">
      <div><strong>от 15 000 ₽</strong><span>минимальный заказ</span></div>
      <div><strong>от 100 бухт</strong><span>доставка по условиям <a href="#delivery">завода</a></span></div>
      <div><strong>16–32 мм</strong><span>диаметры в каталоге</span></div>
      <div><strong>Ваша СТМ</strong><span>производство под вашим брендом</span></div>
    </section>
  </>
}
