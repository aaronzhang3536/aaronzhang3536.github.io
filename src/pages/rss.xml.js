import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('posts')).sort((a, b) => +b.data.date - +a.data.date);
  return rss({
    title: '一帧之内 · Within One Frame',
    description: 'UE5 引擎定制、实时渲染与角色技术笔记；也写深度学习、脑机接口，和管弦乐。',
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      link: `/posts/${p.id}/`,
      categories: [p.data.cat],
      description: `「${p.data.cat}」专栏 · 约 ${p.data.mins} 分钟读完`,
    })),
  });
}
