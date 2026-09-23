import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ShoppingBag } from "lucide-react";
import "./App.css";
import { Catalog } from "./components/Catalog";
import {
  Certificates,
  Delivery,
  Production,
} from "./components/CompanySections";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { ContactSection, LeadForm } from "./components/LeadForm";
import { LegalPage, type LegalKind } from "./components/Legal";
import { ProductModal } from "./components/ProductModal";
import { getProducts } from "./lib/api";
import seedProducts from "./data/products.json";
import type { Product } from "./types";
import { articles, articlePath } from './data/editorial';
import { landingPages } from './data/pages';
import { applySeo, normalizePath } from './lib/seo';
import { ArticlePage, BlogPage, BlogPreview, Breadcrumbs, CategoryLinks, Landing, NotFound } from './components/Editorial';

function loadCart(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("rpz-cart") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, count]) => Number.isInteger(count) && count >= 1 && count <= 9999,
      ),
    );
  } catch {
    return {};
  }
}
function App({ path = typeof window === 'undefined' ? '/' : window.location.pathname }: { path?: string }) {
  const [products, setProducts] = useState<Product[]>(
    seedProducts as Product[],
  );
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartLoaded, setCartLoaded] = useState(false);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const pathname = normalizePath(path);
  const route = pathname.slice(1);
  const article = articles.find(item => articlePath(item) === pathname);
  const landing = landingPages.find(item => item.path === pathname);
  const legalKind = ["privacy", "terms", "consent"].includes(route)
    ? (route as LegalKind)
    : null;
  const selected = useMemo(
    () =>
      Object.keys(cart).filter((sku) =>
        products.some((product) => product.sku === sku),
      ),
    [cart, products],
  );
  const items = useMemo(
    () =>
      products
        .filter((product) => selected.includes(product.sku))
        .map((product) => ({ product, quantity: cart[product.sku] })),
    [products, selected, cart],
  );

  useEffect(() => {
    applySeo(pathname);
  }, [pathname]);

  useEffect(() => {
    let frame = 0;
    const scrollToHash = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
        } catch {
          // Ignore malformed fragments in incoming links.
        }
      });
    };
    // In development the target sections do not exist until React mounts.
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, [pathname]);

  // Read browser storage after hydration so the initial markup matches static HTML.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { setCart(loadCart()); setCartLoaded(true); }, []);

  useEffect(() => {
    const controller = new AbortController();
    getProducts(controller.signal)
      .then((result) => setProducts(result.products))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!cartLoaded) return;
    try {
      localStorage.setItem("rpz-cart", JSON.stringify(cart));
    } catch {
      /* Selection remains usable without storage. */
    }
  }, [cart, cartLoaded]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    document
      .querySelectorAll(
        ".section-heading, .production-copy, .production-image, .step, .contact-intro",
      )
      .forEach((node) => {
        node.classList.add("reveal");
        observer.observe(node);
      });
    return () => observer.disconnect();
  }, []);
  const toggleSelected = useCallback((sku: string) => {
    setCart((current) => {
      const next = { ...current };
      if (next[sku]) delete next[sku];
      else next[sku] = 1;
      return next;
    });
  }, []);
  const setQuantity = useCallback((sku: string, quantity: number) => {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[sku];
      else next[sku] = quantity;
      return next;
    });
  }, []);

  if (legalKind)
    return (
      <div className="app-shell">
        <LegalPage kind={legalKind} />
        <Footer />
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Перейти к содержимому</a>
      <Header
        pathname={pathname}
        selectionCount={selected.length}
        onOpenRequest={() => setRequestOpen(true)}
      />
      {pathname === '/' ? <main id="main-content" className="home-page">
        <Hero onOpenRequest={() => setRequestOpen(true)} />
        <Production />
        <Delivery />
        <Certificates />
        <BlogPreview />
        <ContactSection items={items} onQuantity={setQuantity} />
      </main> : pathname === '/blog' ? <BlogPage /> : article ? <ArticlePage article={article} /> : landing ? <Landing page={landing} onRequest={() => setRequestOpen(true)}>{landing.material && <Catalog products={products.filter(product => product.material === landing.material)} selected={selected} onToggleSelected={toggleSelected} onOpenProduct={setActiveProduct} showAll />}</Landing> : pathname === '/catalog' ? <main id="main-content" className="editorial-page"><div className="editorial-container"><Breadcrumbs items={[{ label: 'Каталог' }]} /><header className="catalog-page-heading"><span className="eyebrow">ПРОДУКЦИЯ ОТ ЗАВОДА</span><h1>Гофрированные трубы<br />и комплектующие.</h1><p>ПВХ и ПНД для защиты кабелей и проводов. Выберите материал, нагрузку и диаметр или обсудите заказное исполнение.</p></header><CategoryLinks active="/catalog" /></div><Catalog products={products} selected={selected} onToggleSelected={toggleSelected} onOpenProduct={setActiveProduct} showAll /></main> : <NotFound />}
      <Footer />
      {selected.length > 0 && !requestOpen && !activeProduct && (
        <button
          className="floating-request"
          onClick={() => setRequestOpen(true)}
        >
          <ShoppingBag size={19} />
          <span>
            В заявке <b>{selected.length}</b>
          </span>
          <span className="floating-label">Перейти к расчёту</span>
          <ArrowRight size={18} />
        </button>
      )}
      {activeProduct && (
        <ProductModal
          product={activeProduct}
          selected={selected.includes(activeProduct.sku)}
          onToggleSelected={() => toggleSelected(activeProduct.sku)}
          onClose={() => setActiveProduct(null)}
        />
      )}
      {requestOpen && (
        <LeadForm
          mode="modal"
          items={items}
          onQuantity={setQuantity}
          onClose={() => setRequestOpen(false)}
        />
      )}
    </div>
  );
}
export default App;
