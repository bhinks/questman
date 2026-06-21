import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Sub-path hosting: set VITE_BASE (e.g. /questman/) at build time so emitted
  // asset URLs are prefixed when served behind a reverse proxy under a path.
  // Defaults to '/' for standalone use.
  base: process.env.VITE_BASE || '/',
})
