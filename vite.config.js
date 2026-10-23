import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// Project site: https://rjtrenchard.github.io/rjt.github.io/
// Dev stays at / so `npm run dev` is unchanged.
const pagesBase = '/rjt.github.io/'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? pagesBase : '/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
}))
