import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RangeDays } from './App';
import { accountLabel, filterLabel, fmtNumber, rangeLabel } from './format';
import { dailySeries, engagement, type DayPoint } from './metrics';
import { PostCard } from './TopPosts';
import { filterAccountId, inFilter, type Filter, type Post, type Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  days: RangeDays;
}

type MetricKey = 'views' | 'likes' | 'engagement';
const PANELS: { key: MetricKey; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'engagement', label: 'Total engagement' },
];

/** How posts are ranked in the day panel, by the mini-chart that was clicked. */
const RANK: Record<MetricKey, { label: string; score: (p: Post) => number | null }> = {
  views: { label: 'views', score: (p) => p.views },
  likes: { label: 'likes', score: (p) => p.likes },
  engagement: { label: 'engagement', score: engagement },
};
const DAY_TOP_N = 3;

const dayLabel = (date: string, withWeekday = false) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
  });

/** Reads a CSS custom property so chart colors stay defined in styles.css. */
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function PerformanceChart({ snapshot, filter, days }: Props) {
  // Only the panel under the pointer (or keyboard focus) shows the full tooltip;
  // the others show just the synced crosshair.
  const [activePanel, setActivePanel] = useState<MetricKey | null>(null);
  // The day opened by clicking a point, and which metric's chart it was clicked on.
  const [selected, setSelected] = useState<{ date: string; metric: MetricKey } | null>(null);
  // Last day the tooltip pointed at (mouse or arrow keys), so Enter can open it.
  const activeDate = useRef<string | null>(null);
  const dayPanelRef = useRef<HTMLDivElement>(null);

  // A different view means a different set of days.
  useEffect(() => setSelected(null), [filter.group, filter.platform, days]);
  useEffect(() => {
    if (selected) dayPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const posts = snapshot.posts.filter(
    (p) => snapshot.sources[p.accountId]?.status === 'ok' && inFilter(filter, p),
  );
  const data = dailySeries(posts, new Date(snapshot.generatedAt), days);
  // One account: its platform's accent. Several accounts: neutral ink.
  const single = filterAccountId(filter);
  const color = cssVar(single ? `--c-${filter.platform}` : '--text');
  const panels = PANELS.filter((panel) => data.some((d) => d[panel.key] !== null && d[panel.key] !== 0));
  const title = filterLabel(snapshot, filter);

  const open = (date: string | null | undefined, metric: MetricKey) => {
    const point = data.find((d) => d.date === date);
    if (point && point.posts > 0) setSelected({ date: point.date, metric });
  };
  const onPanelKey = (e: KeyboardEvent, metric: MetricKey) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(activeDate.current, metric);
    } else if (e.key === 'Escape') setSelected(null);
  };

  const dayPosts = selected
    ? posts
        .filter((p) => p.publishedAt.slice(0, 10) === selected.date)
        .sort((a, b) => (RANK[selected.metric].score(b) ?? -1) - (RANK[selected.metric].score(a) ?? -1))
        .slice(0, DAY_TOP_N)
    : [];

  return (
    <section className="card chart-card" aria-labelledby="perf-title">
      <div className="section-head">
        <h2 id="perf-title">Performance · {title}</h2>
        <p className="muted">
          Daily totals, {rangeLabel(days)}. Hover a point for the numbers; click it (or press Enter) to see
          that day's top posts.
        </p>
      </div>

      {panels.length === 0 ? (
        <p className="empty">No posts in this period.</p>
      ) : (
        panels.map((panel, i) => (
          <div
            key={panel.key}
            className="chart-panel"
            onMouseEnter={() => setActivePanel(panel.key)}
            onFocus={() => setActivePanel(panel.key)}
            onMouseLeave={() => setActivePanel(null)}
            onKeyDown={(e) => onPanelKey(e, panel.key)}
          >
            <h3 className="panel-label">{panel.label}</h3>
            <ResponsiveContainer width="100%" height={i === panels.length - 1 ? 150 : 120}>
              <LineChart
                data={data}
                syncId="perf"
                margin={{ top: 8, right: 12, bottom: i === panels.length - 1 ? 0 : 8, left: 0 }}
                onClick={(state) => open(state?.activeLabel as string | undefined, panel.key)}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid stroke={cssVar('--border')} strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => dayLabel(d)}
                  hide={i !== panels.length - 1}
                  tick={{ fontSize: 12, fill: cssVar('--text-muted') }}
                  tickLine={false}
                  axisLine={{ stroke: cssVar('--border') }}
                  minTickGap={24}
                />
                <YAxis
                  width={48}
                  tickFormatter={(n: number) => fmtNumber(n)}
                  tick={{ fontSize: 12, fill: cssVar('--text-muted') }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ stroke: cssVar('--text-muted'), strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0].payload as DayPoint;
                    activeDate.current = point.date;
                    return activePanel === panel.key ? (
                      <DayTooltip point={point} hasViews={panels.some((p) => p.key === 'views')} />
                    ) : null;
                  }}
                />
                {selected && <ReferenceLine x={selected.date} stroke={cssVar('--text')} strokeWidth={1.5} />}
                <Line
                  type="linear"
                  dataKey={panel.key}
                  name={panel.label}
                  stroke={color}
                  strokeWidth={2}
                  dot={(props: DotProps) => (
                    <ClickableDot key={props.index} {...props} color={color} onSelect={(date) => open(date, panel.key)} />
                  )}
                  // Clicks pass through the hover dot to the clickable point underneath.
                  activeDot={{ r: 6, fill: color, stroke: cssVar('--surface'), strokeWidth: 2, pointerEvents: 'none' }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))
      )}
      {selected && (
        <div
          ref={dayPanelRef}
          className="day-panel"
          role="region"
          aria-label={`Top posts on ${dayLabel(selected.date, true)}`}
          onKeyDown={(e) => e.key === 'Escape' && setSelected(null)}
        >
          <div className="day-panel-head">
            <h3>
              Top posts on {dayLabel(selected.date, true)}
              <span className="muted"> · by {RANK[selected.metric].label}</span>
            </h3>
            <button type="button" className="arrow" onClick={() => setSelected(null)} aria-label="Close day panel">
              ×
            </button>
          </div>
          <div className="strip">
            {dayPosts.map((post, i) => (
              <PostCard key={post.id} post={post} rank={i + 1} label={single ? undefined : accountLabel(snapshot, post.accountId)} />
            ))}
          </div>
        </div>
      )}
      <p className="stat-note">
        Each point is one UTC day: the totals, as of the last scrape, for posts published that day.
        Engagement = likes + comments + shares.
      </p>
    </section>
  );
}

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: DayPoint;
}

/**
 * A data point with its own click handler and a larger invisible tap target, so a point
 * can be opened with a tap on touch screens, where the chart's own click doesn't fire.
 */
function ClickableDot({ cx, cy, payload, color, onSelect }: DotProps & { color: string; onSelect: (date: string) => void }) {
  if (cx === undefined || cy === undefined || !payload) return <g />;
  return (
    <g
      className="point"
      // pointerup rather than click: Recharts' touch handling suppresses the click after a tap.
      // A drag that becomes a scroll fires pointercancel instead, so scrolling won't open a day.
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect(payload.date);
      }}
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: 'pointer' }}
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={4} fill={color} stroke={cssVar('--surface')} strokeWidth={2} />
    </g>
  );
}

function DayTooltip({ point, hasViews }: { point: DayPoint; hasViews: boolean }) {
  return (
    <div className="tooltip">
      <div className="tooltip-date">{dayLabel(point.date, true)}</div>
      <dl>
        <dt>Posts</dt>
        <dd>{point.posts}</dd>
        {hasViews && (
          <>
            <dt>Views</dt>
            <dd>{fmtNumber(point.views)}</dd>
          </>
        )}
        <dt>Likes</dt>
        <dd>{fmtNumber(point.likes)}</dd>
        <dt>Engagement</dt>
        <dd>{fmtNumber(point.engagement)}</dd>
      </dl>
    </div>
  );
}
