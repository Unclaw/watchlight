import { defineConfig } from 'vite';

export default defineConfig({
  // './' base keeps the build working from a Capacitor WKWebView (file://)
  // as well as any static host / PWA origin.
  base: './',
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000, strictPort: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 8192,
  },
});
