import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'legacy-page-redirects',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/$/, '');
        const destination = ({ '/proizvodstvo-stm': '/#about', '/certificates': '/#certificates' } as Record<string, string>)[pathname];
        if (!destination) return next();
        res.writeHead(301, { Location: destination });
        res.end();
      });
    },
  }],
})
