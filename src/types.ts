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
  id: string;
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

export interface AccountSummary {
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
  accounts: AccountSummary[];
  posts: Post[];
  episodes: PodcastEpisode[];
  sources: Record<Platform, SourceInfo>;
}
