// Minimal ambient types for the node builtins used by vite.config.ts.
// @types/node is intentionally NOT a dependency (runtime deps = phaser
// only); these declarations cover exactly the surface the build config
// uses. If the config ever needs more, prefer adding @types/node over
// growing this file.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string;
}
