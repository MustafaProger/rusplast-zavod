import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { SiteContent } from './lib/content'

declare global { interface Window { __RPZ_CONTENT__?: SiteContent } }

const container = document.getElementById('root')!
const app = <StrictMode><App content={window.__RPZ_CONTENT__} /></StrictMode>
if (container.hasChildNodes()) hydrateRoot(container, app)
else createRoot(container).render(app)
