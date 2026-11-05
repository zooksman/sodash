import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RangeDays } from './App';
import { accountLabel, fmtDate, fmtNumber, PLATFORM_LABEL, platformColor, rangeLabel } from './format';
import { engagement, postsInPeriod } from './metrics';
import type { Filter, Platform, Post, PostMedia, Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  days: RangeDays;
  filter: Filter;
  accountId: string;
  onAccount: (id: string) => void;
}

const TOP_N = 5;
/** Video-first platforms rank by views; the rest by likes + comments + shares. */
const RANK_BY_VIEWS: Platform[] = ['youtube', 'tiktok'];

/** Height of the media area per platform when the media has no known aspect ratio. */
const EMBED_HEIGHT: Partial<Record<Platform, number>> = { instagram: 460, facebook: 360 };

/** One account's best posts: by views on YouTube and TikTok, by engagement elsewhere. */
export function topPosts(posts: Post[], accountId: string, platform: Platform, n = TOP_N): Post[] {
  const score = (p: Post) => (RANK_BY_VIEWS.includes(platform) ? p.views : engagement(p)) ?? -1;
  return posts
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => score(b) - score(a))
    .slice(0, n);
}

export default function TopPosts({ snapshot, days, filter, accountId, onAccount }: Props) {
  // Tabs: every account in the selected group (or all accounts), one per platform.
  const available = snapshot.accounts.filter(
    (a) => snapshot.sources[a.id]?.status === 'ok' && (filter.group === 'all' || a.group === filter.group),
  );
  const manyGroups = new Set(available.map((a) => a.group)).size > 1;
  const tabLabel = (id: string, platform: Platform) => (manyGroups ? accountLabel(snapshot, id) : PLATFORM_LABEL[platform]);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stripRef.current?.scrollTo({ left: 0 });
  }, [accountId, days]);

  const current = available.find((a) => a.id === accountId) ?? available[0];
  if (!current) return null;

  const index = available.indexOf(current);
  const go = (step: number, focus = false) => {
    const next = available[(index + step + available.length) % available.length];
    onAccount(next.id);
    if (focus) tabRefs.current[next.id]?.focus();
  };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1, true);
    else if (e.key === 'ArrowLeft') go(-1, true);
    else return;
    e.preventDefault();
  };

  const inRange = postsInPeriod(snapshot.posts, new Date(snapshot.generatedAt), days);
  const top = topPosts(inRange, current.id, current.platform);

  return (
    <section className="card carousel" aria-labelledby="top-title">
      <div className="section-head">
        <h2 id="top-title">Top posts</h2>
        <p className="muted">
          Top {TOP_N} per account by {RANK_BY_VIEWS.includes(current.platform) ? 'views' : 'engagement'}, {rangeLabel(days)}.
        </p>
      </div>

      <div className="carousel-nav">
        <button type="button" className="arrow" onClick={() => go(-1)} aria-label="Previous account">‹</button>
        <div className="tabs" role="tablist" aria-label="Account">
          {available.map((a) => (
            <button
              key={a.id}
              ref={(el) => { tabRefs.current[a.id] = el; }}
              type="button"
              role="tab"
              id={`tab-${a.id}`}
              aria-selected={a.id === current.id}
              aria-controls="top-panel"
              tabIndex={a.id === current.id ? 0 : -1}
              className="tab"
              onClick={() => onAccount(a.id)}
              onKeyDown={onTabKey}
            >
              <span className="dot" style={{ background: platformColor(a.platform) }} aria-hidden />
              {tabLabel(a.id, a.platform)}
            </button>
          ))}
        </div>
        <button type="button" className="arrow" onClick={() => go(1)} aria-label="Next account">›</button>
      </div>

      <div id="top-panel" role="tabpanel" aria-labelledby={`tab-${current.id}`}>
        {top.length === 0 ? (
          <p className="empty">No {accountLabel(snapshot, current.id)} posts in this period.</p>
        ) : (
          <div key={`${current.id}-${days}`} ref={stripRef} className="strip" tabIndex={0} aria-label="Posts, scroll sideways for more">
            {top.map((post, i) => (
              <PostCard key={post.id} post={post} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** A post with its media. `label` (e.g. "OMG · Instagram") names the account when posts from several are mixed. */
export function PostCard({ post, rank, label }: { post: Post; rank: number; label?: string }) {
  const metrics: [string, number | null][] = [
    ['views', post.views],
    ['likes', post.likes],
    ['comments', post.comments],
    ['shares', post.shares],
  ];
  return (
    <article className="post">
      {post.media && <Media media={post.media} platform={post.platform} title={`Media for post #${rank}`} />}
      <div className="post-body">
        <div className="post-meta">
          <span className="post-rank">
            {label && <span className="dot" style={{ background: platformColor(post.platform) }} aria-hidden />}
            #{rank}
            {label && ` · ${label}`}
          </span>
          <time dateTime={post.publishedAt}>{fmtDate(post.publishedAt)}</time>
        </div>
        <p className="post-text">{post.text || <span className="muted">(no text)</span>}</p>
        <dl className="post-metrics">
          {metrics
            .filter(([, v]) => v !== null) // hide metrics the platform doesn't publish
            .map(([label, v]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{fmtNumber(v)}</dd>
              </div>
            ))}
        </dl>
        <a className="post-link" href={post.url} target="_blank" rel="noreferrer">
          View on {PLATFORM_LABEL[post.platform]} ↗
        </a>
      </div>
    </article>
  );
}

export function Media({ media, platform, title }: { media: PostMedia; platform: Platform; title: string }) {
  const [measured, setMeasured] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Instagram's embed reports its content height via postMessage; size the frame to fit.
  useEffect(() => {
    if (platform !== 'instagram') return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://www.instagram.com' || e.source !== frameRef.current?.contentWindow) return;
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg?.type === 'MEASURE' && msg.details?.height > 0) setMeasured(msg.details.height);
      } catch {
        // not a message we understand
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [platform]);

  const style = measured
    ? { height: measured }
    : media.aspectRatio
      ? { aspectRatio: String(Math.max(media.aspectRatio, 9 / 16)) }
      : { height: EMBED_HEIGHT[platform] ?? 400 };

  if (media.kind === 'image') {
    return <div className="media" style={style}><img src={media.src} alt="" loading="lazy" /></div>;
  }
  if (media.kind === 'video') {
    return (
      <div className="media" style={style}>
        <video src={media.src} poster={media.poster} controls preload="none" playsInline />
      </div>
    );
  }
  return (
    <div className="media" style={style}>
      <iframe
        ref={frameRef}
        src={media.src}
        title={title}
        loading="lazy"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
