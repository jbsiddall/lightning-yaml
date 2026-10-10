import { defineConfig } from "tsup";

// Two build passes:
//  1. The library: ESM (*.js) + CJS (*.cjs) + type declarations, for the three
//     public entry points. Code-splitting shares the ~210 KB parser core in
//     src/index.ts across the compat entries instead of duplicating it.
//  2. A minified IIFE global (`YAML`, mirroring the built-in `JSON`) for
//     CDN / <script> use.
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
    globalName: "YAML",
    minify: true,
    dts: false,
    splitting: false,
    treeshake: true,
    clean: false,
    sourcemap: false,
    target: "es2022",
    platform: "browser",
    outDir: "dist",
    banner: {
      js: `/*! Dafny generated code license

Copyright by the contributors to the Dafny Project.

SPDX-License-Identifier: MIT

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/`,
    },
    // iife's default extension is `.global.js`; force plain `.js` so the file
    // is exactly dist/lightning-yaml.min.js per the packaging contract.
    outExtension() {
      return { js: ".js" };
    },
  },
]);
