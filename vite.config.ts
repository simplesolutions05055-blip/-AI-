import { defineConfig } from 'vite';

// The UI is a single static page (index.html, built from ui/primeos-mockup.html).
export default defineConfig({
  server: { port: 8080 },
  build: { chunkSizeWarningLimit: 2000 },
});
