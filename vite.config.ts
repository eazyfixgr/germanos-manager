import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Base path is the repo name so it works on GitHub Pages at
// https://eazyfixgr.github.io/germanos-manager/
export default defineConfig({
  base: '/germanos-manager/',
  plugins: [react(), tailwindcss()],
})
