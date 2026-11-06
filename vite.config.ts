import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const root = dirname(fileURLToPath(import.meta.url));

/**
 * L8: the SW cache name is the PWA update trigger — it must change every
 * release, or installed home-screen testers keep playing the stale cached
 * shell and file bug reports against already-fixed code. Single source of
 * truth is package.json "version": Vite copies public/ verbatim, so after
 * the copy we stamp `watchlight-v<version>` over the __SW_CACHE__
 * placeholder in dist/sw.js. A missing placeholder FAILS the build — an
 * unstamped shell must never ship. (Dev never registers the SW: main.ts
 * gates registration on import.meta.env.PROD, so the placeholder is inert.)
 */
function swCacheVersion(): Plugin {
  const cacheName = `watchlight-v${pkg.version}`;
  return {
    name: 'sw-cache-version',
    apply: 'build',
    closeBundle() {
      const swPath = resolve(root, 'dist/sw.js');
      const src = readFileSync(swPath, 'utf8');
      if (src.includes(`'${cacheName}'`)) return; // already stamped (re-run)
      if (!src.includes('__SW_CACHE__')) {
        throw new Error('sw-cache-version: dist/sw.js has no __SW_CACHE__ placeholder to stamp');
      }
      writeFileSync(swPath, src.replace('__SW_CACHE__', cacheName));
      this.info(`sw.js cache name stamped: ${cacheName}`);
    },
  };
}

export default defineConfig({
  // './' base keeps the build working from a Capacitor WKWebView (file://)
  // as well as any static host / PWA origin.
  base: './',
  // app-visible version stamp (menu footer): like the SW cache name, the
  // single source of truth is package.json — release bump = package.json ONLY
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000, strictPort: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 8192,
  },
  plugins: [swCacheVersion()],
});
