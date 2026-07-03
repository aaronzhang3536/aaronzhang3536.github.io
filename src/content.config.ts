import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/posts' }),
  schema: z.object({
    title: z.string(),
    cat: z.enum(['渲染管线', '引擎定制', '角色技术', '读渲染', 'AI 与认知', '音乐与生活']),
    date: z.coerce.date(),
    mins: z.number(),
    tags: z.array(z.string()).default([]),
    /** 独立 HTML 文章（如 Yotei 系列）：iframe 指向 public 下的页面 */
    iframe: z.string().optional(),
  }),
});

export const collections = { posts };
