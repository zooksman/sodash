import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Filter, RangeDays } from './App';
import { fmtNumber, PLATFORM_LABEL, rangeLabel } from './format';
import { dailySeries, type DayPoint } from './metrics';
import type { Snapshot } from './types';

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

  const posts = snapshot.posts.filter(
    (p) => snapshot.sources[p.platform].status === 'ok' && (filter === 'all' || p.platform === filter),
  );
  const data = dailySeries(posts, new Date(snapshot.generatedAt), days);
  const color = cssVar(filter === 'all' ? '--text' : `--c-${filter}`);
  const panels = PANELS.filter((panel) => data.some((d) => d[panel.key] !== null && d[panel.key] !== 0));
  const title = filter === 'all' ? 'All accounts' : PLATFORM_LABEL[filter];

  return (
    <section className="card chart-card" aria-labelledby="perf-title">
      <div className="section-head">
        <h2 id="perf-title">Performance · {title}</h2>
        <p className="muted">
          Daily totals, {rangeLabel(days)}. Hover a point, or focus a chart and use the arrow keys.
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
          >
            <h3 className="panel-label">{panel.label}</h3>
            <ResponsiveContainer width="100%" height={i === panels.length - 1 ? 150 : 120}>
              <LineChart data={data} syncId="perf" margin={{ top: 8, right: 12, bottom: i === panels.length - 1 ? 0 : 8, left: 0 }}>
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
                  content={({ active, payload }) =>
                    active && activePanel === panel.key && payload?.length ? (
                      <DayTooltip point={payload[0].payload as DayPoint} hasViews={panels.some((p) => p.key === 'views')} />
                    ) : null
                  }
                />
                <Line
                  type="linear"
                  dataKey={panel.key}
                  name={panel.label}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 4, fill: color, stroke: cssVar('--surface'), strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: color, stroke: cssVar('--surface'), strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))
      )}
      <p className="stat-note">
        Each point is one UTC day: the totals, as of the last scrape, for posts published that day.
        Engagement = likes + comments + shares.
      </p>
    </section>
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
