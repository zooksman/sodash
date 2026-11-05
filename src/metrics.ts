import type { AccountSummary, Platform, Post } from './types';

/**
 * Parses counts like 1234, "3,400", "1.2K", "2M" into numbers.
 * Anything missing or unparseable becomes null (never 0).
 */
export function parseCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!match) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(parseFloat(match[1]) * multiplier);
}

/** likes + comments + shares, ignoring null fields. Null if all three are null. */
export function engagement(post: Post): number | null {
  const parts = [post.likes, post.comments, post.shares].filter((n): n is number => n !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/** Average engagement per post, skipping posts with no engagement data. */
export function avgEngagement(posts: Post[]): number | null {
  const values = posts.map(engagement).filter((n): n is number => n !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Engagement rate = avg engagement per post / followers, per platform.
 * For several platforms, a follower-weighted average of the per-platform rates
 * (which equals sum(avg engagement) / sum(followers) over platforms with data).
 */
export function engagementRate(posts: Post[], accounts: AccountSummary[]): number | null {
  let weighted = 0;
  let totalFollowers = 0;
  for (const account of accounts) {
    if (!account.followers) continue;
    const avg = avgEngagement(posts.filter((p) => p.platform === account.platform));
    if (avg === null) continue;
    weighted += (avg / account.followers) * account.followers;
    totalFollowers += account.followers;
  }
  return totalFollowers ? weighted / totalFollowers : null;
}

/** Metrics that exist for each platform in public data. Used to hide unavailable stats. */
export const AVAILABLE_METRICS: Record<Platform, { likes: boolean; comments: boolean; shares: boolean; views: boolean }> = {
  x: { likes: true, comments: true, shares: true, views: true },
  facebook: { likes: true, comments: true, shares: true, views: true },
  instagram: { likes: true, comments: true, shares: false, views: true },
  tiktok: { likes: true, comments: true, shares: true, views: true },
  youtube: { likes: true, comments: true, shares: false, views: true },
};

// ---------------------------------------------------------------------------
// Period helpers (stat cards). All date math is in UTC so results are deterministic.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;

/** Posts published in [end - days*(offset+1), end - days*offset). offset 0 = current period. */
export function postsInPeriod(posts: Post[], end: Date, days: number, offset = 0): Post[] {
  const to = end.getTime() - offset * days * DAY_MS;
  const from = to - days * DAY_MS;
  return posts.filter((p) => {
    const t = Date.parse(p.publishedAt);
    return t >= from && t < to;
  });
}

/** Percent change from previous to current, or null when there is no baseline. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekday (UTC) with the highest average engagement per post. */
export function bestDayOfWeek(posts: Post[]): { day: string; avg: number } | null {
  let best: { day: string; avg: number } | null = null;
  WEEKDAYS.forEach((day, i) => {
    const avg = avgEngagement(posts.filter((p) => new Date(p.publishedAt).getUTCDay() === i));
    if (avg !== null && (best === null || avg > best.avg)) best = { day, avg };
  });
  return best;
}

export function postsPerWeek(postCount: number, days: number): number {
  return postCount / (days / 7);
}

// ---------------------------------------------------------------------------
// Daily series (performance chart)
// ---------------------------------------------------------------------------
export interface DayPoint {
  date: string; // YYYY-MM-DD (UTC)
  posts: number;
  likes: number | null;
  views: number | null;
  engagement: number | null;
}

/** Sum of the non-null values, or null if every value is null. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * One point per UTC calendar day for the `days` days ending on `end`'s day.
 * Each day totals the lifetime counts (as of the scrape) of posts published that day.
 * Days with no posts are 0; days whose posts all lack a metric are null.
 */
export function dailySeries(posts: Post[], end: Date, days: number): DayPoint[] {
  const byDay = new Map<string, Post[]>();
  for (const p of posts) {
    const key = p.publishedAt.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  const lastDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const points: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(lastDay - i * DAY_MS).toISOString().slice(0, 10);
    const dayPosts = byDay.get(date) ?? [];
    points.push({
      date,
      posts: dayPosts.length,
      likes: dayPosts.length ? sumOrNull(dayPosts.map((p) => p.likes)) : 0,
      views: dayPosts.length ? sumOrNull(dayPosts.map((p) => p.views)) : 0,
      engagement: dayPosts.length ? sumOrNull(dayPosts.map(engagement)) : 0,
    });
  }
  return points;
}
