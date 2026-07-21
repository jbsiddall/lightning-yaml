import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import sitemap from '@astrojs/sitemap'
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc'

export default defineConfig({
  // `site` feeds the generated sitemap's URLs, so it must be the canonical domain
  // Vercel serves, not the raw *.vercel.app host.
  site: 'https://lightning-yaml.dev',
  integrations: [
    sitemap(),
    starlight({
      title: 'Lightning YAML',
      tagline: 'Spec-compliant YAML parsing, out to give JSON.parse a run for its money.',
      customCss: [
        // Self-hosted fonts (Inter = body, IBM Plex Mono = display/data/code).
        // Loaded BEFORE theme.css so --sl-font / --sl-font-mono resolve to them.
        '@fontsource/inter/400.css',
        '@fontsource/inter/600.css',
        '@fontsource/ibm-plex-mono/400.css',
        '@fontsource/ibm-plex-mono/500.css',
        './src/styles/theme.css',
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jbsiddall/lightning-yaml' }],
      plugins: [
        starlightTypeDoc({
          entryPoints: ['../src/index.ts', '../src/yaml-compat.ts', '../src/js-yaml-compat.ts'], // the real parser + drop-in compat shims — API reference is generated from their TSDoc
          tsconfig: '../tsconfig.json',
          output: 'api',
          sidebar: { label: 'API reference', collapsed: false },
          typeDoc: {
            // markdown plugin is auto-added by starlight-typedoc; keep output clean
            skipErrorChecking: true,
            excludeInternal: true,
            // Without a configured readme, starlight-typedoc deletes every
            // per-module README page (libs/typedoc.ts onRendererPageEnd) — which is
            // exactly where each module's TSDoc block renders. The compat shims'
            // top-of-file `@packageDocumentation` blocks (the master source for the
            // compatibility matrix) live on those pages, so point readme at a real
            // file to keep them.
            readme: './typedoc-readme.md',
          },
        }),
      ],
      sidebar: [
        // Starlight >=0.39 removed top-level `autogenerate` on a sidebar group;
        // it must be nested inside `items`.
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Playground', link: '/playground/' },
        { label: 'Benchmarks', link: '/benchmarks/' },
        { label: 'Research', items: [{ autogenerate: { directory: 'research' } }] },
        typeDocSidebarGroup,
      ],
    }),
  ],
})
