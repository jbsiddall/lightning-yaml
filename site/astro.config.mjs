import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc'

// Primary deploy is Vercel (root path). The optional GitHub Pages fallback workflow
// sets PAGES_BASE (e.g. "/lightning-yaml") so project-page asset paths resolve.
const PAGES_BASE = process.env.PAGES_BASE

export default defineConfig({
  site: PAGES_BASE ? 'https://jbsiddall.github.io' : 'https://lightning-yaml.vercel.app',
  base: PAGES_BASE || undefined,
  integrations: [
    starlight({
      title: 'Lightning YAML',
      tagline: 'A YAML parser at JSON speed.',
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
          },
        }),
      ],
      sidebar: [
        // Starlight >=0.39 removed top-level `autogenerate` on a sidebar group;
        // it must be nested inside `items`.
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Benchmarks', link: '/benchmarks/' },
        { label: 'Research', items: [{ autogenerate: { directory: 'research' } }] },
        typeDocSidebarGroup,
      ],
    }),
  ],
})
