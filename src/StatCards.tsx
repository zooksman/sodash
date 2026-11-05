import type { RangeDays } from './App';
import { accountLabel, fmtNumber, fmtPct, PLATFORM_LABEL, rangeLabel } from './format';
import {
  avgEngagement,
  bestDayOfWeek,
  engagementRate,
  mediaComparison,
  pctChange,
  postsInPeriod,
  postsPerWeek,
} from './metrics';
import { filterAccountId, inFilter, type Filter, type Platform, type Post, type Snapshot } from './types';

const DAY_MS = 86_400_000;

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  days: RangeDays;
}

interface Card {
  label: string;
  value: string;
  delta?: number | null; // percent change vs previous period; undefined = card has no delta
  note?: string;
  wide?: boolean; // spans the full row
}

export default function StatCards({ snapshot, filter, days }: Props) {
  const end = new Date(snapshot.generatedAt);
  const inScope = (item: { group: string; platform: Platform; accountId?: string; id?: string }) =>
    snapshot.sources[item.accountId ?? item.id ?? '']?.status === 'ok' && inFilter(filter, item);
  const posts = snapshot.posts.filter(inScope);
  const accounts = snapshot.accounts.filter(inScope);

  const current = postsInPeriod(posts, end, days, 0);

  // Deltas only compare accounts whose scraped history covers at least 90% of the previous
  // period; otherwise an account with a short history would look like a sudden jump.
  const prevStart = end.getTime() - 2 * days * DAY_MS + 0.1 * days * DAY_MS;
  const accountIds = accounts.map((a) => a.id);
  const covered = accountIds.filter((id) =>
    posts.some((p) => p.accountId === id && Date.parse(p.publishedAt) <= prevStart),
  );
  const excluded = accountIds.filter((id) => !covered.includes(id));
  const onlyCovered = (list: Post[]) => list.filter((p) => covered.includes(p.accountId));
  const curCov = onlyCovered(current);
  const prevCov = onlyCovered(postsInPeriod(posts, end, days, 1));
  const covAccounts = accounts.filter((a) => covered.includes(a.id));
  // Within one group, the platform name is enough; across groups, say whose account it is.
  const oneGroup = new Set(accounts.map((a) => a.group)).size <= 1;
  const nameOf = (id: string) =>
    oneGroup ? PLATFORM_LABEL[accounts.find((a) => a.id === id)!.platform] : accountLabel(snapshot, id);

  const rateNow = engagementRate(current, accounts);
  const rateCov = engagementRate(curCov, covAccounts);
  const ratePrev = engagementRate(prevCov, covAccounts);
  const followers = accounts.reduce((sum, a) => sum + (a.followers ?? 0), 0);
  const best = bestDayOfWeek(current);

  const deltaNote = covered.length === 0
    ? `not enough history before this period to compare (needs ${days * 2} days)`
    : excluded.length
      ? `vs previous ${days === 1 ? '24 hours' : `${days} days`} · excl. ${excluded.length > 3 ? `${excluded.length} accounts` : excluded.map(nameOf).join(', ')} (short history)`
      : `vs previous ${days === 1 ? '24 hours' : `${days} days`}`;

  const cards: Card[] = [
    {
      label: `Posts, ${rangeLabel(days)}`,
      value: fmtNumber(current.length),
      delta: covered.length ? pctChange(curCov.length, prevCov.length) : null,
      note: deltaNote,
    },
    {
      label: 'Avg engagement per post',
      value: fmtNumber(avgEngagement(current)),
      delta: pctChange(avgEngagement(curCov), avgEngagement(prevCov)),
      note: deltaNote,
    },
    {
      label: 'Engagement rate',
      value: fmtPct(rateNow === null ? null : rateNow * 100, 2),
      delta: pctChange(rateCov, ratePrev),
      note: `${deltaNote}. Avg engagement ÷ followers${filterAccountId(filter) ? '' : ' (weighted)'}`,
    },
    {
      label: 'Total followers',
      value: fmtNumber(accounts.some((a) => a.followers !== null) ? followers : null),
      note: 'Current public counts (no history available)',
    },
    {
      label: 'Best day of week',
      // A range shorter than a week doesn't contain every weekday, so there's nothing to compare.
      value: days >= 7 ? (best?.day ?? '—') : '—',
      note:
        days < 7
          ? 'Needs a range of 7 days or more'
          : best
            ? `${fmtNumber(best.avg)} avg engagement, ${rangeLabel(days)} (UTC)`
            : undefined,
    },
    {
      label: 'Posting cadence',
      value: `${postsPerWeek(current.length, days).toFixed(1)}/wk`,
      delta: covered.length ? pctChange(curCov.length, prevCov.length) : null,
      note: deltaNote,
    },
    mediaCard(current, accounts.map((a) => a.platform), nameOf),
  ];

  return (
    <section className="stat-grid" aria-label="Key stats">
      {cards.map((c) => (
        <div key={c.label} className={`card stat${c.wide ? ' stat-wide' : ''}`}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value">{c.value}</div>
          {c.delta !== undefined && <Delta value={c.delta} />}
          {c.note && <div className="stat-note">{c.note}</div>}
        </div>
      ))}
    </section>
  );
}

/** Posts with an image or video vs posts without, by typical (median) engagement. */
/** 1.7× or 277× (no decimal once it's big). */
const times = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)}×`;

function mediaCard(current: Post[], platforms: Platform[], nameOf: (id: string) => string): Card {
  const label = 'Posts with images or video vs without';
  const cmp = mediaComparison(current);
  const ALWAYS_MEDIA: Platform[] = ['instagram', 'tiktok', 'youtube'];
  const alwaysMedia = ALWAYS_MEDIA.filter((pl) => platforms.includes(pl)).map((pl) => PLATFORM_LABEL[pl]);
  if (!cmp) {
    return {
      label,
      value: '—',
      wide: true,
      note:
        current.length > 0 && current.every((p) => p.media !== null)
          ? 'Every post in this period has an image or video, so there’s nothing to compare.'
          : `Not enough posts of both kinds in this period to compare (needs 5+ of each per account; ${current.filter((p) => p.media === null).length} without media).`,
    };
  }
  const { ratio, accounts } = cmp;
  // Always phrase it as "N× more" for whichever kind does better.
  const value =
    ratio >= 1 ? `${times(ratio)} more engagement with media` : `${times(1 / ratio)} more engagement without media`;
  const always = alwaysMedia.length ? ` ${alwaysMedia.join(', ')} posts always include media.` : '';
  if (accounts.length === 1) {
    const [a] = accounts;
    return {
      label,
      value,
      wide: true,
      note:
        `Typical post with an image or video: ${fmtNumber(Math.round(a.withMedia.typical))} engagement (${a.withMedia.count} posts). ` +
        `Without: ${fmtNumber(Math.round(a.without.typical))} (${a.without.count} posts). Based on ${nameOf(a.accountId)}.${always}`,
    };
  }
  // Several accounts: if they disagree, say how many favour media rather than average
  // opposite results into one misleading number.
  const mediaWins = accounts.filter((a) => a.ratio >= 1).length;
  const agree = mediaWins === 0 || mediaWins === accounts.length;
  const each = accounts
    .map((a) =>
      a.ratio >= 1
        ? `${nameOf(a.accountId)} ${times(a.ratio)} more with media`
        : `${nameOf(a.accountId)} ${times(1 / a.ratio)} more without`,
    )
    .join(', ');
  return {
    label,
    value: agree ? value : `Media wins on ${mediaWins} of ${accounts.length} accounts`,
    wide: true,
    note: `Compared within each account${agree ? ', then averaged' : ''}: ${each}.${always}`,
  };
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <div className="stat-delta">No comparison</div>;
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '■';
  const word = value > 0 ? 'up' : value < 0 ? 'down' : 'unchanged';
  return (
    <div className="stat-delta" aria-label={`${word} ${Math.abs(value).toFixed(1)} percent`}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </div>
  );
}
