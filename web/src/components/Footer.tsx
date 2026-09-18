export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <a className="brand brand-inverse" href="/#top"><span className="brand-mark">РПЗ</span><span className="brand-rule" /><span className="brand-name">РУСПЛАСТЗАВОД</span></a>
        <nav aria-label="Навигация в подвале"><a href="/">Главная</a><a href="/catalog">Каталог</a><a href="/blog">Блог</a></nav>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} ООО «РУСПЛАСТЗАВОД»</span><div><a href="/privacy">Политика конфиденциальности</a><a href="/terms">Пользовательское соглашение</a></div></div>
    </footer>
  )
}
