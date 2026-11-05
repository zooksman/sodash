/**
 * Insight rules for the Highlights cards. Each rule is a pure function that returns a
 * plain-English insight, or null when the platform doesn't have enough data for it.
 * Engagement = likes + comments + shares (null fields ignored), as on the stat cards.
 * Comparisons use the median post ("typical post") so one viral post can't swing them,
 * and posts under 48 hours old are left out because they're still collecting engagement.
 */
import { fmtNumber } from './format';
import { engagement, postsInPeriod } from './metrics';
import type { Platform, Post, Snapshot } from './types';

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

// ---------------------------------------------------------------------------
// Platform-specific insights: one per platform, built around what that platform's
// public data is best at.
// ---------------------------------------------------------------------------

/** X: best 4-hour block of the day to post, in the viewer's time zone. */
export function bestTimeInsight(posts: Post[], platform: Platform, timeZone: string): Insight | null {
  const scored = withEngagement(posts);
  if (scored.length < MIN_POSTS) return null;
  const hourOf = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone });
  const blocks = new Map<number, Post[]>();
  for (const p of scored) {
    const block = Math.floor(Number(hourOf.format(new Date(p.publishedAt))) / 4);
    blocks.set(block, [...(blocks.get(block) ?? []), p]);
  }
  const ranked = [...blocks.entries()]
    .filter(([, list]) => list.length >= 5)
    .map(([block, list]) => ({ block, typical: medianEngagement(list), count: list.length }))
    .sort((a, b) => b.typical - a.typical);
  if (ranked.length < 3) return null;
  const label = (block: number) => {
    const fmt = (h: number) => `${h % 12 || 12}${h < 12 || h === 24 ? 'am' : 'pm'}`;
    return `${fmt(block * 4)}–${fmt(block * 4 + 4)}`;
  };
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const overall = medianEngagement(scored);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')?.value;
  return {
    id: `${platform}-time`,
    platform,
    title: 'Best time to post',
    text:
      `Posts published ${label(best.block)}${zone ? ` ${zone}` : ''} got a typical ${n(best.typical)} engagement, ` +
      `${(best.typical / overall).toFixed(1)}× the account’s typical ${n(overall)} (${best.count} posts). ` +
      `Weakest window: ${label(worst.block)} (${n(worst.typical)}).`,
  };
}

/** Facebook: how often posts get passed on: shares per 100 likes, and the most-shared post. */
export function shareRateInsight(posts: Post[], platform: Platform): Insight | null {
  const both = posts.filter((p) => p.likes !== null && p.shares !== null);
  if (both.length < MIN_POSTS) return null;
  const likes = both.reduce((s, p) => s + p.likes!, 0);
  const shares = both.reduce((s, p) => s + p.shares!, 0);
  if (likes === 0) return null;
  const top = both.reduce((a, b) => (b.shares! > a.shares! ? b : a));
  return {
    id: `${platform}-shares`,
    platform,
    title: 'How often posts get shared',
    text:
      `For every 100 likes, posts earned ${Math.round((shares / likes) * 100)} shares. ` +
      `Most shared: “${truncate(top.text || 'untitled post')}” (${n(top.shares!)} shares, ${shortDate(top.publishedAt)}).`,
  };
}

/** Instagram: videos (posts with a play count) vs photos and carousels. */
export function videoVsPhotoInsight(posts: Post[], platform: Platform): Insight | null {
  const scored = withEngagement(posts);
  const videos = scored.filter((p) => p.views !== null);
  const photos = scored.filter((p) => p.views === null);
  if (videos.length < 3 || photos.length < 3) return null;
  const v = medianEngagement(videos);
  const ph = medianEngagement(photos);
  if (v === 0 || ph === 0) return null;
  const ratio = v >= ph ? v / ph : ph / v;
  const winner = v >= ph ? 'Videos' : 'Photos and carousels';
  return {
    id: `${platform}-format`,
    platform,
    title: 'Videos vs photos',
    text:
      `${winner} perform better: a typical video got ${n(v)} engagement vs ${n(ph)} for photos and carousels ` +
      `(${ratio.toFixed(1)}×), across ${videos.length} videos and ${photos.length} photos.`,
  };
}

/** TikTok: typical views compared with the follower count. */
export function reachInsight(posts: Post[], platform: Platform, followers: number | null): Insight | null {
  const viewed = posts.filter((p) => p.views !== null);
  if (viewed.length < MIN_POSTS || !followers) return null;
  const typical = median(viewed.map((p) => p.views!));
  const ratio = typical / followers;
  const beyond = viewed.filter((p) => p.views! > followers).length;
  return {
    id: `${platform}-reach`,
    platform,
    title: 'Reach beyond followers',
    text:
      `A typical video gets ${n(typical)} views, ${ratio.toFixed(1)}× the account’s ${n(followers)} followers, ` +
      `and ${beyond} of ${viewed.length} videos were seen by more people than follow the account` +
      (ratio > 1 ? ', so most views come from TikTok’s For You feed.' : '.'),
  };
}

/** YouTube: share of viewers who like a video, and the best-liked video. */
export function likeRateInsight(posts: Post[], platform: Platform): Insight | null {
  const rated = posts.filter((p) => p.likes !== null && p.views !== null && p.views > 0);
  if (rated.length < MIN_POSTS) return null;
  const rate = (p: Post) => p.likes! / p.views!;
  const typical = median(rated.map(rate));
  const best = rated.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  return {
    id: `${platform}-likerate`,
    platform,
    title: 'Like rate',
    text:
      `${(typical * 100).toFixed(1)}% of viewers like a typical video. ` +
      `Best-liked: “${truncate(best.text || 'untitled video')}” at ${(rate(best) * 100).toFixed(1)}% ` +
      `(${n(best.views!)} views).`,
  };
}

/** Context the platform-specific rules need beyond the posts themselves. */
export interface InsightContext {
  followers: number | null;
  timeZone: string;
}

function platformSpecificInsight(recent: Post[], platform: Platform, ctx: InsightContext): Insight | null {
  switch (platform) {
    case 'x':
      return bestTimeInsight(recent, platform, ctx.timeZone);
    case 'facebook':
      return shareRateInsight(recent, platform);
    case 'instagram':
      return videoVsPhotoInsight(recent, platform);
    case 'tiktok':
      return reachInsight(recent, platform, ctx.followers);
    case 'youtube':
      return likeRateInsight(recent, platform);
  }
}

/** Up to three insights for a platform: the two general ones by priority, then its own. */
export function platformInsights(
  allPosts: Post[],
  platform: Platform,
  generatedAt: Date,
  ctx: InsightContext,
): Insight[] {
  const end = insightEnd(generatedAt);
  const recent = postsInPeriod(allPosts, end, INSIGHT_DAYS).filter((p) => p.platform === platform);
  const general = [
    postingVolumeInsight(recent, platform),
    growthInsight(allPosts, platform, end),
    underperformerInsight(recent, platform),
  ]
    .filter((i): i is Insight => i !== null)
    .slice(0, 2);
  const own = platformSpecificInsight(recent, platform, ctx);
  return own ? [...general, own] : general;
}

/** Insights for a platform straight from the snapshot, in the viewer's time zone. */
export function snapshotInsights(snapshot: Snapshot, platform: Platform): Insight[] {
  return platformInsights(snapshot.posts, platform, new Date(snapshot.generatedAt), {
    followers: snapshot.accounts.find((a) => a.platform === platform)?.followers ?? null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
