/// <reference types="astro/client" />

// Vite's own ambient types (vite/client.d.ts) declare `*?raw`, but Astro's
// client.d.ts only pulls in vite/types/import-meta.d.ts, not the asset-import
// ambient module declarations — so `?raw` imports of non-JS files (our
// benchmark YAML fixtures) need an explicit declaration here.
declare module '*.yaml?raw' {
  const raw: string;
  export default raw;
}
