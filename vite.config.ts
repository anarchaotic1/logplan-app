import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Log/Plan', short_name: 'Log/Plan', description: 'Daily planner, journal and habits. Local-first.',
        theme_color: '#040A18', background_color: '#040A18', display: 'standalone', orientation: 'any', start_url: '.', scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
