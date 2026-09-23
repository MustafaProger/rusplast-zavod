import { ArrowUpRight, ChevronRight, Menu, Phone, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Brand } from './Brand'
import './Header.css'

type HeaderProps = {
  selectionCount: number
  onOpenRequest: () => void
  pathname: string
}

const links = [
  ['Главная', '/'],
  ['Каталог', '/catalog'],
  ['Блог', '/blog'],
]

export function Header({ selectionCount, onOpenRequest, pathname }: HeaderProps) {
  const [open, setOpen] = useState(false)
  const header = useRef<HTMLElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    navigation.current?.querySelector('a')?.focus({ preventScroll: true })
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        menuButton.current?.focus({ preventScroll: true })
      }
    }
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false)
    }
    const desktop = window.matchMedia('(min-width: 961px)')
    const closeOnDesktop = () => {
      if (desktop.matches) {
        if (document.activeElement === menuButton.current || document.activeElement?.closest('.mobile-phone')) {
          navigation.current?.querySelector('a')?.focus({ preventScroll: true })
        }
        setOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOutside)
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOutside)
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [open])

  return (
    <header ref={header} className="site-header" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <div className="header-inner">
        <Brand />
        <nav ref={navigation} id="main-navigation" className={open ? 'main-nav is-open' : 'main-nav'} aria-label="Основная навигация">
          {links.map(([label, href]) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
            return <a key={href} href={href} aria-current={active ? (pathname === href ? 'page' : 'true') : undefined} onClick={() => setOpen(false)}>
              {label}<ChevronRight className="nav-chevron" size={18} aria-hidden="true" />
            </a>
          })}
          <a className="mobile-phone" href="tel:+79660070501" onClick={() => setOpen(false)}>
            <Phone size={20} aria-hidden="true" /><span><small>Отдел продаж</small>+7 (966) 007-05-01</span>
          </a>
        </nav>
        <div className="header-actions">
          <a className="header-phone" href="tel:+79660070501" aria-label="Позвонить в отдел продаж: +7 (966) 007-05-01">
            <Phone size={18} aria-hidden="true" /><span><small>Отдел продаж</small>+7 (966) 007-05-01</span>
          </a>
          <button className="button header-cta" aria-label={selectionCount ? `Открыть заявку, товаров: ${selectionCount}` : 'Получить прайс'} onClick={() => { setOpen(false); onOpenRequest() }}>
            {selectionCount ? <>Заявка <span className="header-count">{selectionCount}</span></> : <><span className="cta-label-full">Получить прайс</span><span className="cta-label-short">Прайс</span><ArrowUpRight className="cta-arrow" size={17} aria-hidden="true" /></>}
          </button>
          <button ref={menuButton} className="menu-button" aria-expanded={open} aria-controls="main-navigation" aria-label={open ? 'Закрыть меню' : 'Открыть меню'} onClick={() => setOpen(value => !value)}>
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  )
}
