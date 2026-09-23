/* oxlint-disable react/only-export-components -- Build-only entry, not a Fast Refresh module. */
import { renderToString } from 'react-dom/server'
import App from './App'
export { getSeo, renderSeo, staticPaths, indexablePaths, getStaticPaths, getIndexablePaths, SITE_URL } from './lib/seo'

import { initialContent, type SiteContent } from './lib/content'
export { fetchSiteContent, initialContent } from './lib/content'

export function render(path: string, content: SiteContent = initialContent) {
  return renderToString(<App path={path} content={content} />)
}
