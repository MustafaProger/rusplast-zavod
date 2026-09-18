import { Menu, Phone, X } from 'lucide-react'
import { useEffect, useState } from 'react'

type HeaderProps = {
  selectionCount: number
  onOpenRequest: () => void
}

const links = [
  ['Главная', '/'],
  ['Каталог', '/catalog'],
  ['Блог', '/blog'],
]

export function Header({ selectionCount, onOpenRequest }: HeaderProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.classList.toggle('menu-open', open)
    return () => document.body.classList.remove('menu-open')
  }, [open])

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="РУСПЛАСТЗАВОД — на главную">
        <span className="brand-mark">РПЗ</span><span className="brand-rule" /><span className="brand-name">РУСПЛАСТЗАВОД</span>
      </a>
      <nav id="main-navigation" className={open ? 'main-nav is-open' : 'main-nav'} aria-label="Основная навигация">
        {links.map(([label, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}
        <a className="mobile-phone" href="tel:+79660070501"><Phone size={18} />+7 (966) 007-05-01</a>
      </nav>
      <div className="header-actions">
        <a className="header-phone" href="tel:+79660070501">+7 (966) 007-05-01</a>
        <button className="button button-primary header-cta" onClick={() => { setOpen(false); onOpenRequest() }}>{selectionCount ? `В заявке: ${selectionCount}` : 'Получить прайс'}</button>
        <button className="menu-button" aria-expanded={open} aria-controls="main-navigation" aria-label={open ? 'Закрыть меню' : 'Открыть меню'} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </div>
    </header>
  )
}
