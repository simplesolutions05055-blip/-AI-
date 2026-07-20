import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  server: {
    host: '::',
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'favicon-64.png',
        'apple-touch-icon.png',
        'primeos-icon-192.png',
        'primeos-icon-512.png',
        'primeos-maskable-512.png',
      ],
      manifest: {
        id: '/app',
        name: 'PrimeOS',
        short_name: 'PrimeOS',
        description: 'מערכת חכמה ליצירה ולניהול של תוצרים עסקיים, תוכן, מסמכים ותהליכי עבודה בעזרת אוטומציה ובינה מלאכותית.',
        lang: 'he',
        dir: 'rtl',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#0b1f3a',
        categories: ['business', 'productivity'],
        prefer_related_applications: false,
        icons: [
          {
            src: '/primeos-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/primeos-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/primeos-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
