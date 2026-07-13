import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc'

export default defineConfig({
  site: 'https://lightning-yaml.vercel.app',
  integrations: [
    starlight({
      title: 'Lightning YAML',
      tagline: 'A YAML parser at JSON speed.',
      customCss: ['./src/styles/theme.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jbsiddall/lightning-yaml' }],
      plugins: [
        starlightTypeDoc({
          entryPoints: ['./src/lib/lightning-yaml.ts'], // documented public-API facade (swap to ../src/index.ts later)
          tsconfig: './tsconfig.json',
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
