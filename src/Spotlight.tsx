import type { RangeDays } from './App';
import { accountLabel, filterLabel, platformColor, rangeLabel } from './format';
import { snapshotInsights } from './insights';
import { engagement, postsInPeriod } from './metrics';
import { PostCard, topPosts } from './TopPosts';
import { filterAccountId, inFilter, type Filter, type Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  days: RangeDays;
}

/**
 * The single best post for the current view, plus the lead insight for its account.
 * Across several accounts, posts are ranked by engagement; a single account uses its own
 * ranking (views for YouTube and TikTok), the same as the Top posts carousel.
 */
export default function Spotlight({ snapshot, filter, days }: Props) {
  const inRange = postsInPeriod(snapshot.posts, new Date(snapshot.generatedAt), days).filter(
    (p) => snapshot.sources[p.accountId]?.status === 'ok' && inFilter(filter, p),
  );
  const single = filterAccountId(filter);
  const singleAccount = single ? snapshot.accounts.find((a) => a.id === single) : undefined;
  const post = singleAccount
    ? topPosts(inRange, singleAccount.id, singleAccount.platform, 1)[0]
    : [...inRange].sort((a, b) => (engagement(b) ?? -1) - (engagement(a) ?? -1))[0];
  const insight = post ? snapshotInsights(snapshot, post.accountId)[0] : undefined;

  return (
    <aside className="spotlight" aria-labelledby="spot-title">
      <div className="section-head">
        <h2 id="spot-title">Spotlight</h2>
        <p className="muted">
          Best post · {filterLabel(snapshot, filter)}, {rangeLabel(days)}.
        </p>
      </div>
      {post ? (
        <div className="spotlight-post">
          <PostCard post={post} rank={1} label={accountLabel(snapshot, post.accountId)} />
        </div>
      ) : (
        <div className="card empty">No posts in this period.</div>
      )}
      {insight && (
        <article className="card insight insight-feature">
          <div className="insight-label">
            <span className="dot" style={{ background: platformColor(insight.platform) }} aria-hidden />
            Top insight · {accountLabel(snapshot, insight.accountId)} · {insight.title}
          </div>
          <p>{insight.text}</p>
        </article>
      )}
    </aside>
  );
}
