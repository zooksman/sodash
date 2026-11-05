import { fmtDate, PLATFORM_LABEL, platformColor } from './format';
import { INSIGHT_DAYS, insightEnd, platformInsights } from './insights';
import type { Platform, Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  platform: Platform;
}

export default function Highlights({ snapshot, platform }: Props) {
  const generatedAt = new Date(snapshot.generatedAt);
  const end = insightEnd(generatedAt);
  const start = new Date(end.getTime() - INSIGHT_DAYS * 86_400_000);
  const insights = platformInsights(snapshot.posts, platform, generatedAt);

  return (
    <section className="highlights" aria-labelledby="hl-title" aria-live="polite">
      <div className="section-head">
        <h2 id="hl-title">Highlights</h2>
        <p className="muted">
          {fmtDate(start.toISOString())} – {fmtDate(end.toISOString())}. Posts under 48 hours old are left out
          while they collect engagement.
        </p>
      </div>
      {insights.length === 0 ? (
        <div className="card empty">Not enough {PLATFORM_LABEL[platform]} posts in this period for insights.</div>
      ) : (
        insights.map((insight) => (
          <article key={insight.id} className="card insight">
            <div className="insight-label">
              <span className="dot" style={{ background: platformColor(insight.platform) }} aria-hidden />
              {PLATFORM_LABEL[insight.platform]} · {insight.title}
            </div>
            <p>{insight.text}</p>
          </article>
        ))
      )}
    </section>
  );
}
