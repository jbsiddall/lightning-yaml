import { defineConfig } from "tsup";

// Two build passes:
//  1. The library: ESM (*.js) + CJS (*.cjs) + type declarations, for the three
//     public entry points. Code-splitting shares the ~210 KB parser core in
//     src/index.ts across the compat entries instead of duplicating it.
//  2. A minified IIFE global (`LightningYAML`) for CDN / <script> use.
export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "yaml-compat": "src/yaml-compat.ts",
      "js-yaml-compat": "src/js-yaml-compat.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    splitting: true,
    treeshake: true,
    clean: true,
    sourcemap: false,
    target: "es2022",
    platform: "neutral",
    outDir: "dist",
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".js" };
    },
  },
  {
    entry: { "lightning-yaml.min": "src/index.ts" },
    format: ["iife"],
    globalName: "LightningYAML",
    minify: true,
    dts: false,
    splitting: false,
    treeshake: true,
    clean: false,
    sourcemap: false,
    target: "es2022",
    platform: "browser",
    outDir: "dist",
    // iife's default extension is `.global.js`; force plain `.js` so the file
    // is exactly dist/lightning-yaml.min.js per the packaging contract.
    outExtension() {
      return { js: ".js" };
    },
  },
]);
