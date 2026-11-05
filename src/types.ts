export type Platform = 'x' | 'facebook' | 'instagram' | 'tiktok' | 'youtube';

export const PLATFORMS: Platform[] = ['x', 'facebook', 'instagram', 'tiktok', 'youtube'];

/**
 * How the UI shows a post's media.
 * - image / video: a direct file URL (only used where the CDN URL doesn't expire: X).
 *   `poster` is the video's still frame.
 * - embed: the platform's official embed player (Instagram, TikTok, Facebook, YouTube),
 *   which loads fresh media itself, so it never goes stale.
 */
export interface PostMedia {
  kind: 'image' | 'video' | 'embed';
  src: string;
  poster?: string;
  aspectRatio?: number; // width / height
}

export interface Post {
  id: string; // unique per account: collab posts can appear on two accounts
  accountId: string; // "<group>-<platform>", e.g. "omg-x"
  group: string;
  platform: Platform;
  url: string;
  text: string;
  publishedAt: string; // ISO 8601
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  media: PostMedia | null;
}

/** A person or brand that owns accounts on several platforms. */
export interface AccountGroup {
  id: string;
  name: string; // "O'Keefe Media Group"
  shortName: string; // "OMG", used where space is tight
}

/** One account on one platform. */
export interface AccountSummary {
  id: string; // "<group>-<platform>"
  group: string;
  platform: Platform;
  handle: string;
  followers: number | null;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  publishedAt: string; // ISO 8601
  durationSec: number | null;
  youtubeViews: number | null;
}

export type SourceStatus = 'ok' | 'missing' | 'failed';

export interface SourceInfo {
  status: SourceStatus;
  scrapedAt: string | null; // ISO 8601, null if never scraped
}

export interface Snapshot {
  generatedAt: string;
  groups: AccountGroup[];
  accounts: AccountSummary[];
  posts: Post[];
  episodes: PodcastEpisode[];
  sources: Record<string, SourceInfo>; // keyed by account id
}

/** What the page is showing: everything, one account group, or one account (group + platform). */
export interface Filter {
  group: string | 'all';
  platform: Platform | 'all';
}

export const ALL: Filter = { group: 'all', platform: 'all' };

/** True if a post or account falls inside the filter. */
export const inFilter = (f: Filter, item: { group: string; platform: Platform }) =>
  (f.group === 'all' || item.group === f.group) && (f.platform === 'all' || item.platform === f.platform);

/** The single account a filter selects, if it selects exactly one. */
export const filterAccountId = (f: Filter): string | null =>
  f.group !== 'all' && f.platform !== 'all' ? `${f.group}-${f.platform}` : null;

export const sameFilter = (a: Filter, b: Filter) => a.group === b.group && a.platform === b.platform;
