import { accountLabel, fmtDate, platformColor } from './format';
import { INSIGHT_DAYS, insightEnd, snapshotInsights } from './insights';
import type { Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  accountId: string;
}

export default function Highlights({ snapshot, accountId }: Props) {
  const generatedAt = new Date(snapshot.generatedAt);
  const end = insightEnd(generatedAt);
  const start = new Date(end.getTime() - INSIGHT_DAYS * 86_400_000);
  const insights = snapshotInsights(snapshot, accountId);
  const label = accountLabel(snapshot, accountId);

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
        <div className="card empty">Not enough {label} posts in this period for insights.</div>
      ) : (
        insights.map((insight) => (
          <article key={insight.id} className="card insight">
            <div className="insight-label">
              <span className="dot" style={{ background: platformColor(insight.platform) }} aria-hidden />
              {label} · {insight.title}
            </div>
            <p>{insight.text}</p>
          </article>
        ))
      )}
    </section>
  );
}
