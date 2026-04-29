import rss, { pagesGlobToRssItems } from '@astrojs/rss';

export async function GET(context) {
  const items = await pagesGlobToRssItems(import.meta.glob('./**/*.md'));
  return rss({
    title: 'Astro Learner Jenny | Blog',
    description: 'My journey learning Astro',
    site: context.site,
    items,
    customData: `<language>en-us</language>`,
  });
}
