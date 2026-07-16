import { defineCollection, z } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // Optional block on a research note that evaluates one optimization; feeds the
        // generated Optimization index. The verdict enum makes a bad value fail the build.
        optimization: z
          .object({
            name: z.string(),
            conclusion: z.string(),
            verdict: z.enum(['promising', 'situational', 'not-worth-it', 'inconclusive']),
          })
          .optional(),
      }),
    }),
  }),
}
