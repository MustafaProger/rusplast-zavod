/* oxlint-disable react/only-export-components -- Build-only entry, not a Fast Refresh module. */
import { renderToString } from 'react-dom/server'
import App from './App'
export { getSeo, renderSeo, staticPaths, indexablePaths, SITE_URL } from './lib/seo'

export function render(path: string) {
  return renderToString(<App path={path} />)
}
