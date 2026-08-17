import type { MetadataRoute } from 'next';

/**
 * There was no robots.txt, so every route was crawlable by default —
 * including the token-bearing public surfaces. A share link that reaches a
 * crawled page, a Slack unfurl or a mail-scanner preview could be indexed,
 * and several of these tokens (heads-up, QR category, contractor upload,
 * kiosk) have no expiry, so an indexed one is a permanent public leak.
 *
 * The disallow list is belt-and-braces with the `X-Robots-Tag: noindex`
 * header set for the same paths in `next.config.ts` — robots.txt asks a
 * well-behaved crawler not to fetch, the header tells it not to index what
 * it fetched anyway.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: [
          '/s/', // public share links (inspections, heads-up, RAMS client packs)
          '/scan/', // anonymous QR report forms
          '/render/', // Puppeteer-facing print routes
          '/api/',
          '/invite/', // invitation acceptance tokens
          '/gate/', // contractor kiosk tokens
          '/monitoring', // Sentry tunnel
        ],
      },
    ],
  };
}
