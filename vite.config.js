import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `--mode electron` builds for the packaged desktop till, which loads the app
// from file:// and therefore needs relative asset paths.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'electron' ? './' : '/',
  // Separate folders, because the two builds are not interchangeable: the web
  // build uses absolute /assets/ paths, which under file:// point at the root of
  // the drive. Sharing dist/ meant a web build silently replaced the desktop one
  // and the till opened to an empty window.
  build: { outDir: mode === 'electron' ? 'dist-desktop' : 'dist' },
  server: {
    port: 5173,
    // Fail instead of drifting to the next free port. The next port up is 5174,
    // which is the admin API's — Vite would take it, the API could not start,
    // and /api would proxy back into Vite. The Electron dev build is also
    // pointed at 5173 specifically, so a moved server means a blank till.
    strictPort: true,
    // The admin API runs as a separate local process (see server/admin-api.mjs).
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.ADMIN_API_PORT || 5174}`,
        changeOrigin: true,
      },
    },
  },
}))
