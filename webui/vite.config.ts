import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev workflow:
//   Terminal 1: bash scripts/dev-web.sh   → uvicorn on :8765 (API + dist)
//   Terminal 2: cd webui && npm run dev   → vite on :5173, proxies /api → :8765
// Do NOT run vite on port 8765 — that collides with uvicorn and breaks API proxying.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
})
