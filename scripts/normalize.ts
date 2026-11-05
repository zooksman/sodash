/**
 * Reads data/raw/<platform>.json, maps each actor's output to the normalized types,
 * and writes public/data/snapshot.json for the UI.
 *
 * Mappers are written against the actual fields in the raw files (inspected 2026-11-05).
 * Podcast RSS is not wired up yet, so `episodes` is always empty.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCount } from '../src/metrics';
import { PLATFORMS, type AccountSummary, type Platform, type Post, type PostMedia, type Snapshot, type SourceInfo } from '../src/types';

// Keep the latest MIN_POSTS per platform, plus anything newer than HISTORY_DAYS, so that
// high-volume accounts still cover the current and previous 30-day periods.
const MIN_POSTS = 100;
const HISTORY_DAYS = 65; // 2 × 30-day periods, plus the 2 days insights skip, plus margin
const RAW_DIR = join(process.cwd(), 'data', 'raw');
const OUT_FILE = join(process.cwd(), 'public', 'data', 'snapshot.json');

const ENV_VARS: Record<Platform, string> = {
  x: 'X_URL',
  facebook: 'FACEBOOK_URL',
  instagram: 'INSTAGRAM_URL',
  tiktok: 'TIKTOK_URL',
  youtube: 'YOUTUBE_URL',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawItem = Record<string, any>;
interface RawFile {
  _meta: { url: string; scrapedAt: string };
  items: { posts?: RawItem[]; profile?: RawItem[] };
}
interface Mapped {
  posts: Post[];
  followers: number | null;
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function handleFromUrl(url: string): string {
  const path = new URL(url).pathname.split('/').filter(Boolean);
  return (path[0] ?? '').replace(/^@/, '');
}

// ---------------------------------------------------------------------------
// X (xquik/x-tweet-scraper). Retweets are dropped: their counts belong to the original tweet.
// ---------------------------------------------------------------------------
function mapX(raw: RawFile): Mapped {
  const items = raw.items.posts ?? [];
  const posts = items
    .filter((t) => t.isRetweet !== true)
    .map((t): Post | null => {
      const publishedAt = iso(t.createdAt);
      if (!publishedAt || !t.id) return null;
      const retweets = parseCount(t.retweetCount);
      const quotes = parseCount(t.quoteCount);
      return {
        id: `x-${t.id}`,
        platform: 'x',
        url: t.url,
        text: t.text ?? '',
        publishedAt,
        likes: parseCount(t.likeCount),
        comments: parseCount(t.replyCount),
        shares: retweets === null && quotes === null ? null : (retweets ?? 0) + (quotes ?? 0),
        views: parseCount(t.viewCount),
        media: xMedia(t.media?.[0]),
      };
    });
  return { posts: compact(posts), followers: parseCount(items[0]?.author?.followers) };
}

/** X media URLs (pbs.twimg.com / video.twimg.com) are unsigned, so they can be used directly. */
function xMedia(m: RawItem | undefined): PostMedia | null {
  if (!m?.mediaUrl) return null;
  const aspectRatio = m.width && m.height ? m.width / m.height : undefined;
  if (m.type === 'video' || m.type === 'animated_gif') {
    // Pick the highest-bitrate MP4 at or under ~1 Mbps to keep playback light.
    const mp4s = (m.videoVariants ?? [])
      .filter((v: RawItem) => v.contentType === 'video/mp4')
      .sort((a: RawItem, b: RawItem) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
    const pick = mp4s.filter((v: RawItem) => (v.bitrate ?? 0) <= 1_000_000).pop() ?? mp4s[0];
    if (pick) return { kind: 'video', src: pick.url, poster: m.mediaUrl, aspectRatio };
  }
  return { kind: 'image', src: m.mediaUrl, aspectRatio };
}

// ---------------------------------------------------------------------------
// Facebook (apify/facebook-posts-scraper + apify/facebook-pages-scraper for followers)
// ---------------------------------------------------------------------------
function mapFacebook(raw: RawFile): Mapped {
  const posts = (raw.items.posts ?? []).map((p): Post | null => {
    const publishedAt = iso(p.time);
    if (!publishedAt || !p.postId) return null;
    return {
      id: `facebook-${p.postId}`,
      platform: 'facebook',
      url: p.url,
      text: p.text ?? '',
      publishedAt,
      likes: parseCount(p.likes),
      comments: parseCount(p.comments),
      shares: parseCount(p.shares),
      views: parseCount(p.viewsCount),
      media: facebookMedia(p),
    };
  });
  return { posts: compact(posts), followers: parseCount(raw.items.profile?.[0]?.followers) };
}

/** Facebook CDN URLs expire within days, so use the official post/video embed plugin. */
function facebookMedia(p: RawItem): PostMedia | null {
  const type = p.media?.[0]?.__typename;
  if (!p.url || (type !== 'Video' && type !== 'Photo')) return null;
  const href = encodeURIComponent(p.url);
  return type === 'Video'
    ? { kind: 'embed', src: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false`, aspectRatio: 16 / 9 }
    : { kind: 'embed', src: `https://www.facebook.com/plugins/post.php?href=${href}&show_text=false` };
}

// ---------------------------------------------------------------------------
// Instagram (apify/instagram-scraper: posts + details). No public share count.
// ---------------------------------------------------------------------------
function mapInstagram(raw: RawFile): Mapped {
  const posts = (raw.items.posts ?? []).map((p): Post | null => {
    const publishedAt = iso(p.timestamp);
    if (!publishedAt || !p.id) return null;
    return {
      id: `instagram-${p.id}`,
      platform: 'instagram',
      url: p.url,
      text: p.caption ?? '',
      publishedAt,
      likes: parseCount(p.likesCount),
      comments: parseCount(p.commentsCount),
      shares: null,
      views: parseCount(p.videoPlayCount), // only present on videos
      // CDN URLs expire within days, so use the official embed.
      media: p.shortCode ? { kind: 'embed', src: `https://www.instagram.com/p/${p.shortCode}/embed/` } : null,
    };
  });
  return { posts: compact(posts), followers: parseCount(raw.items.profile?.[0]?.followersCount) };
}

// ---------------------------------------------------------------------------
// TikTok (clockworks/tiktok-scraper, profile mode). Followers come from authorMeta.
// ---------------------------------------------------------------------------
function mapTiktok(raw: RawFile): Mapped {
  const items = raw.items.posts ?? [];
  const posts = items.map((v): Post | null => {
    const publishedAt = iso(v.createTimeISO);
    if (!publishedAt || !v.id) return null;
    return {
      id: `tiktok-${v.id}`,
      platform: 'tiktok',
      url: v.webVideoUrl,
      text: v.text ?? '',
      publishedAt,
      likes: parseCount(v.diggCount),
      comments: parseCount(v.commentCount),
      shares: parseCount(v.shareCount),
      views: parseCount(v.playCount),
      // CDN URLs expire within days, so use the official player.
      media: { kind: 'embed', src: `https://www.tiktok.com/player/v1/${v.id}`, aspectRatio: 9 / 16 },
    };
  });
  return { posts: compact(posts), followers: parseCount(items[0]?.authorMeta?.fans) };
}

// ---------------------------------------------------------------------------
// YouTube (streamers/youtube-scraper). No public share count.
// ---------------------------------------------------------------------------
function mapYoutube(raw: RawFile): Mapped {
  const items = raw.items.posts ?? [];
  const posts = items.map((v): Post | null => {
    const publishedAt = iso(v.date);
    if (!publishedAt || !v.id) return null;
    return {
      id: `youtube-${v.id}`,
      platform: 'youtube',
      url: v.url,
      text: v.title ?? '',
      publishedAt,
      likes: parseCount(v.likes),
      comments: parseCount(v.commentsCount),
      shares: null,
      views: parseCount(v.viewCount),
      // The official player shows its own thumbnail and play button.
      media: { kind: 'embed', src: `https://www.youtube.com/embed/${v.id}`, aspectRatio: 16 / 9 },
    };
  });
  return { posts: compact(posts), followers: parseCount(items[0]?.numberOfSubscribers) };
}

// ---------------------------------------------------------------------------

const MAPPERS: Record<Platform, (raw: RawFile) => Mapped> = {
  x: mapX,
  facebook: mapFacebook,
  instagram: mapInstagram,
  tiktok: mapTiktok,
  youtube: mapYoutube,
};

function compact(posts: (Post | null)[]): Post[] {
  return posts.filter((p): p is Post => p !== null);
}

function main(): void {
  const accounts: AccountSummary[] = [];
  const posts: Post[] = [];
  const sources = {} as Record<Platform, SourceInfo>;

  for (const platform of PLATFORMS) {
    const file = join(RAW_DIR, `${platform}.json`);
    const url = process.env[ENV_VARS[platform]]?.trim();

    if (!existsSync(file)) {
      // URL set but nothing on disk means the scrape never succeeded.
      sources[platform] = { status: url ? 'failed' : 'missing', scrapedAt: null };
      console.log(`[${platform}] no raw file (${sources[platform].status})`);
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as RawFile;
      const mapped = MAPPERS[platform](raw);
      const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
      const latest = mapped.posts
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .filter((p, i) => i < MIN_POSTS || p.publishedAt >= cutoff);
      posts.push(...latest);
      accounts.push({ platform, handle: handleFromUrl(raw._meta.url), followers: mapped.followers });
      sources[platform] = { status: 'ok', scrapedAt: raw._meta.scrapedAt };
      console.log(`[${platform}] ${latest.length} posts, followers ${mapped.followers ?? 'n/a'}`);
    } catch (err) {
      sources[platform] = { status: 'failed', scrapedAt: null };
      console.error(`[${platform}] could not normalize: ${err instanceof Error ? err.message : err}`);
    }
  }

  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), accounts, posts, episodes: [], sources };
  mkdirSync(join(process.cwd(), 'public', 'data'), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`wrote ${OUT_FILE} (${posts.length} posts)`);
}

main();
