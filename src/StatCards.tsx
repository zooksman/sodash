import type { Filter, RangeDays } from './App';
import { fmtNumber, fmtPct, PLATFORM_LABEL, rangeLabel } from './format';
import {
  avgEngagement,
  bestDayOfWeek,
  engagementRate,
  pctChange,
  postsInPeriod,
  postsPerWeek,
} from './metrics';
import type { Platform, Post, Snapshot } from './types';

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
}

export default function StatCards({ snapshot, filter, days }: Props) {
  const end = new Date(snapshot.generatedAt);
  const inScope = (p: { platform: Platform }) =>
    snapshot.sources[p.platform].status === 'ok' && (filter === 'all' || p.platform === filter);
  const posts = snapshot.posts.filter(inScope);
  const accounts = snapshot.accounts.filter(inScope);

  const current = postsInPeriod(posts, end, days, 0);

  // Deltas only compare platforms whose scraped history covers at least 90% of the previous
  // period; otherwise a platform with a short history would look like a sudden jump.
  const prevStart = end.getTime() - 2 * days * DAY_MS + 0.1 * days * DAY_MS;
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const covered = platforms.filter((pl) =>
    posts.some((p) => p.platform === pl && Date.parse(p.publishedAt) <= prevStart),
  );
  const excluded = platforms.filter((pl) => !covered.includes(pl));
  const onlyCovered = (list: Post[]) => list.filter((p) => covered.includes(p.platform));
  const curCov = onlyCovered(current);
  const prevCov = onlyCovered(postsInPeriod(posts, end, days, 1));
  const covAccounts = accounts.filter((a) => covered.includes(a.platform));

  const rateNow = engagementRate(current, accounts);
  const rateCov = engagementRate(curCov, covAccounts);
  const ratePrev = engagementRate(prevCov, covAccounts);
  const followers = accounts.reduce((sum, a) => sum + (a.followers ?? 0), 0);
  const best = bestDayOfWeek(current);

  const deltaNote = covered.length === 0
    ? 'no data for previous period'
    : excluded.length
      ? `vs previous ${days === 1 ? '24 hours' : `${days} days`} · excl. ${excluded.map((p) => PLATFORM_LABEL[p]).join(', ')} (short history)`
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
      note: `${deltaNote}. Avg engagement ÷ followers${filter === 'all' ? ' (weighted)' : ''}`,
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
  ];

  return (
    <section className="stat-grid" aria-label="Key stats">
      {cards.map((c) => (
        <div key={c.label} className="card stat">
          <div className="stat-label">{c.label}</div>
          <div className="stat-value">{c.value}</div>
          {c.delta !== undefined && <Delta value={c.delta} />}
          {c.note && <div className="stat-note">{c.note}</div>}
        </div>
      ))}
    </section>
  );
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
