import rss, { pagesGlobToRssItems } from '@astrojs/rss';

export async function GET(context) {
  const items = await pagesGlobToRssItems(import.meta.glob('./**/*.md'));
  const requestOrigin = (() => {
    try {
      return new URL(context.request.url).origin;
    } catch {
      return context.site;
    }
  })();
  return rss({
    title: 'Astro Learner Jenny | Blog',
    description: 'My journey learning Astro',
    site: requestOrigin,
    items,
    customData: `<language>en-us</language>`,
  });
}
