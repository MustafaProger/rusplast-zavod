import { Brand } from './Brand'

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <Brand />
        <nav aria-label="Навигация в подвале"><a href="/">Главная</a><a href="/catalog">Каталог</a><a href="/blog">Блог</a></nav>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} ООО «РУСПЛАСТЗАВОД»</span><div><a href="/privacy">Политика конфиденциальности</a><a href="/terms">Пользовательское соглашение</a></div></div>
    </footer>
  )
}
