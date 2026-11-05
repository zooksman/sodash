/**
 * Insight rules for the Highlights cards. Each rule is a pure function that returns a
 * plain-English insight, or null when the platform doesn't have enough data for it.
 * Engagement = likes + comments + shares (null fields ignored), as on the stat cards.
 * Comparisons use the median post ("typical post") so one viral post can't swing them,
 * and posts under 48 hours old are left out because they're still collecting engagement.
 */
import { fmtNumber } from './format';
import { engagement, postsInPeriod } from './metrics';
import type { Platform, Post } from './types';

export interface Insight {
  id: string;
  platform: Platform;
  title: string;
  text: string;
}

const DAY_MS = 86_400_000;
export const INSIGHT_DAYS = 30;
const MIN_POSTS = 10;
const SETTLE_DAYS = 2;

/** Insights cover the INSIGHT_DAYS ending SETTLE_DAYS before the snapshot. */
export const insightEnd = (generatedAt: Date) => new Date(generatedAt.getTime() - SETTLE_DAYS * DAY_MS);

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);
const truncate = (text: string, n = 60) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const withEngagement = (posts: Post[]) => posts.filter((p) => engagement(p) !== null);
const medianEngagement = (posts: Post[]) => median(withEngagement(posts).map((p) => engagement(p)!));
const n = (x: number) => fmtNumber(Math.round(x));

/**
 * Posts per day vs engagement. Splits posting days into "light" days (at or below the
 * median number of posts per day) and "heavy" days (above it), then compares engagement
 * per post and total engagement per day.
 */
export function postingVolumeInsight(posts: Post[], platform: Platform): Insight | null {
  const scored = withEngagement(posts);
  if (scored.length < MIN_POSTS) return null;

  const byDay = new Map<string, Post[]>();
  for (const p of scored) {
    const day = p.publishedAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const days = [...byDay.values()];
  const threshold = Math.floor(median(days.map((d) => d.length)));
  const light = days.filter((d) => d.length <= threshold);
  const heavy = days.filter((d) => d.length > threshold);
  if (light.length < 3 || heavy.length < 3) return null;

  const perPost = (group: Post[][]) => medianEngagement(group.flat());
  const perDay = (group: Post[][]) =>
    group.reduce((sum, d) => sum + d.reduce((s, p) => s + (engagement(p) ?? 0), 0), 0) / group.length;
  const lightPost = perPost(light);
  const heavyPost = perPost(heavy);
  const ratio = perDay(heavy) / perDay(light);
  const lightLabel = threshold === 1 ? '1 post' : `1–${threshold} posts`;
  const heavyLabel = `${threshold + 1}+ posts`;

  if (lightPost === 0 || perDay(light) === 0) return null;
  const perPostChange = pct(heavyPost, lightPost);
  const postPart =
    Math.abs(perPostChange) < 10
      ? `the typical post did about as well (${n(heavyPost)} vs ${n(lightPost)} engagement)`
      : `the typical post got ${n(heavyPost)} engagement vs ${n(lightPost)} on days with ${lightLabel} (${perPostChange > 0 ? '+' : ''}${perPostChange}%)`;
  const dayPart =
    ratio >= 1.1
      ? `total engagement per day was ${ratio.toFixed(1)}× higher`
      : ratio <= 0.9
        ? `total engagement per day was ${Math.round((1 - ratio) * 100)}% lower`
        : 'total engagement per day was about the same';
  const verdict =
    ratio >= 1.1 && perPostChange >= -10
      ? 'More posts are adding engagement without diluting it.'
      : ratio >= 1.1
        ? 'Extra posts still add engagement overall, but each one earns less.'
        : 'Extra posts aren’t adding engagement.';

  return {
    id: `${platform}-volume`,
    platform,
    title: 'Posts per day vs engagement',
    text: `On days with ${heavyLabel}, ${postPart}, and ${dayPart}. ${verdict}`,
  };
}

/** 30-day growth: engagement per post and post count vs the previous 30 days. */
export function growthInsight(allPosts: Post[], platform: Platform, end: Date): Insight | null {
  const own = allPosts.filter((p) => p.platform === platform);
  const oldest = Math.min(...own.map((p) => Date.parse(p.publishedAt)));
  // Same coverage rule as the stat cards: history must reach ≥90% into the previous period.
  if (oldest > end.getTime() - 2 * INSIGHT_DAYS * DAY_MS + 0.1 * INSIGHT_DAYS * DAY_MS) return null;

  const current = postsInPeriod(own, end, INSIGHT_DAYS, 0);
  const previous = postsInPeriod(own, end, INSIGHT_DAYS, 1);
  if (current.length < MIN_POSTS || previous.length < MIN_POSTS) return null;
  const now = medianEngagement(current);
  const before = medianEngagement(previous);
  if (before === 0) return null;

  const change = pct(now, before);
  const postsChange = pct(current.length, previous.length);
  const direction = change >= 0 ? 'up' : 'down';
  return {
    id: `${platform}-growth`,
    platform,
    title: '30-day growth',
    text:
      `Typical engagement per post is ${direction} ${Math.abs(change)}% vs the previous 30 days ` +
      `(${n(now)} vs ${n(before)}), on ${current.length} posts vs ${previous.length}` +
      (postsChange === 0 ? '.' : ` (${postsChange > 0 ? '+' : ''}${postsChange}%).`),
  };
}

/** Below-average posts: share of posts earning under half the median engagement. */
export function underperformerInsight(posts: Post[], platform: Platform): Insight | null {
  const scored = withEngagement(posts);
  if (scored.length < MIN_POSTS) return null;
  const typical = medianEngagement(scored);
  const weak = scored.filter((p) => engagement(p)! < typical / 2);
  if (weak.length === 0 || typical === 0) return null;
  const weakest = weak.reduce((a, b) => (engagement(b)! < engagement(a)! ? b : a));
  const share = Math.round((weak.length / scored.length) * 100);
  return {
    id: `${platform}-weak`,
    platform,
    title: 'Below-average posts',
    text:
      `${weak.length} of ${scored.length} posts (${share}%) earned under half the typical ` +
      `${n(typical)} engagement. Weakest: “${truncate(weakest.text || 'untitled post')}” ` +
      `(${n(engagement(weakest)!)}, ${shortDate(weakest.publishedAt)}).`,
  };
}

/** The two insights shown for a platform, in priority order. */
export function platformInsights(allPosts: Post[], platform: Platform, generatedAt: Date): Insight[] {
  const end = insightEnd(generatedAt);
  const recent = postsInPeriod(allPosts, end, INSIGHT_DAYS).filter((p) => p.platform === platform);
  return [
    postingVolumeInsight(recent, platform),
    growthInsight(allPosts, platform, end),
    underperformerInsight(recent, platform),
  ]
    .filter((i): i is Insight => i !== null)
    .slice(0, 2);
}
