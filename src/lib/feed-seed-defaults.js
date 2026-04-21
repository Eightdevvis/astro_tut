/**
 * Standard-Allowlist / Blocklist für Topic-Feeds (RSS, https-only).
 * Superuser kann weitere Einträge in der DB pflegen (siehe Super-Settings).
 */

/** @type {{ kind: 'host_suffix' | 'rss_url'; value: string; category: string; trust_tier: number }[]} */
export const DEFAULT_FEED_ALLOWLIST = [
  { kind: 'host_suffix', value: 'arxiv.org', category: 'science', trust_tier: 3 },
  { kind: 'rss_url', value: 'https://arxiv.org/rss/cs.GR', category: 'science', trust_tier: 3 },
  { kind: 'rss_url', value: 'https://arxiv.org/rss/cs.CV', category: 'science', trust_tier: 3 },
  { kind: 'rss_url', value: 'https://arxiv.org/rss/eess.IV', category: 'science', trust_tier: 3 },
  { kind: 'host_suffix', value: 'nature.com', category: 'science', trust_tier: 3 },
  { kind: 'host_suffix', value: 'science.org', category: 'science', trust_tier: 3 },
  { kind: 'host_suffix', value: 'ieee.org', category: 'science', trust_tier: 2 },
  { kind: 'host_suffix', value: 'theverge.com', category: 'news', trust_tier: 2 },
  { kind: 'host_suffix', value: 'wired.com', category: 'news', trust_tier: 2 },
  { kind: 'host_suffix', value: 'techcrunch.com', category: 'news', trust_tier: 2 },
  { kind: 'host_suffix', value: 'reuters.com', category: 'news', trust_tier: 3 },
  { kind: 'host_suffix', value: 'displaydaily.com', category: 'displays', trust_tier: 2 },
  { kind: 'host_suffix', value: 'sid.org', category: 'displays', trust_tier: 2 },
];

/** @type {{ host_pattern: string }[]} */
export const DEFAULT_FEED_BLOCKLIST = [
  { host_pattern: 'naturalnews.com' },
  { host_pattern: 'infowars.com' },
  { host_pattern: 'beforeitsnews.com' },
];
