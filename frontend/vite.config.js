import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  // Trailing slash on the proxy key matters: it stops `/api-connections`
  // (a frontend route) from being mis-routed to the backend just because
  // it starts with `/api`. Only `/api/...` paths get proxied now.
  // `/uploads/` proxies static file downloads (resumes, ID proofs, etc.)
  // served by Express; production nginx mirrors this routing.
  server: { port: 5173, proxy: {
    '/api/':     { target: 'http://localhost:5000', changeOrigin: true },
    '/uploads/': { target: 'http://localhost:5000', changeOrigin: true },
  } }
})
