import type { Filter, RangeDays } from './App';
import { PLATFORM_LABEL, platformColor, rangeLabel } from './format';
import { snapshotInsights } from './insights';
import { engagement, postsInPeriod } from './metrics';
import { PostCard, topPosts } from './TopPosts';
import type { Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  days: RangeDays;
}

/**
 * The single best post for the current view, plus the lead insight for its platform.
 * "All" ranks every platform's posts by engagement; a single platform uses its own
 * ranking (views for YouTube and TikTok), the same as the Top posts carousel.
 */
export default function Spotlight({ snapshot, filter, days }: Props) {
  const inRange = postsInPeriod(snapshot.posts, new Date(snapshot.generatedAt), days).filter(
    (p) => snapshot.sources[p.platform].status === 'ok',
  );
  const post =
    filter === 'all'
      ? [...inRange].sort((a, b) => (engagement(b) ?? -1) - (engagement(a) ?? -1))[0]
      : topPosts(inRange, filter, 1)[0];
  const platform = post?.platform ?? (filter === 'all' ? null : filter);
  const insight = platform ? snapshotInsights(snapshot, platform)[0] : undefined;

  return (
    <aside className="spotlight" aria-labelledby="spot-title">
      <div className="section-head">
        <h2 id="spot-title">Spotlight</h2>
        <p className="muted">
          {filter === 'all' ? 'Best post across all accounts' : `Best ${PLATFORM_LABEL[filter]} post`}, {rangeLabel(days)}.
        </p>
      </div>
      {post ? (
        <div className="spotlight-post">
          <PostCard post={post} rank={1} showPlatform />
        </div>
      ) : (
        <div className="card empty">No posts in this period.</div>
      )}
      {insight && (
        <article className="card insight insight-feature">
          <div className="insight-label">
            <span className="dot" style={{ background: platformColor(insight.platform) }} aria-hidden />
            Top insight · {PLATFORM_LABEL[insight.platform]} · {insight.title}
          </div>
          <p>{insight.text}</p>
        </article>
      )}
    </aside>
  );
}
