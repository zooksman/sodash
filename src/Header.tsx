import { RANGES, type Filter, type RangeDays } from './App';
import { fmtDate, fmtDateTime, greeting, PLATFORM_LABEL, platformColor, rangeLabel } from './format';
import { PLATFORMS, type Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  onFilter: (f: Filter) => void;
  days: RangeDays;
  onDays: (d: RangeDays) => void;
}

export default function Header({ snapshot, filter, onFilter, days, onDays }: Props) {
  const handle = snapshot.accounts.find((a) => a.platform === 'youtube')?.handle;
  return (
    <header className="header">
      <div>
        <h1>{greeting(new Date())}, James</h1>
        <p className="subtitle">Let's see how your social media posts are performing.</p>
        <p className="muted">
          {handle ? `@${handle} · ` : ''}Snapshot generated {fmtDateTime(snapshot.generatedAt)}
        </p>
      </div>

      <div className="segmented" role="group" aria-label="Time range">
        {RANGES.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => onDays(d)} aria-label={rangeLabel(d)}>
            {d === 1 ? '1 day' : `${d} days`}
          </button>
        ))}
      </div>

      <div className="chips" role="group" aria-label="Filter by platform">
        {(['all', ...PLATFORMS] as Filter[]).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {f !== 'all' && <span className="dot" style={{ background: platformColor(f) }} aria-hidden />}
            {f === 'all' ? 'All' : PLATFORM_LABEL[f]}
          </button>
        ))}
      </div>

      <ul className="scraped">
        {PLATFORMS.map((p) => {
          const s = snapshot.sources[p];
          return (
            <li key={p}>
              <span className="dot" style={{ background: platformColor(p) }} aria-hidden />
              {PLATFORM_LABEL[p]}:{' '}
              {s.status === 'ok' ? `scraped ${fmtDate(s.scrapedAt)}` : <span className="warn">{s.status}</span>}
            </li>
          );
        })}
      </ul>
    </header>
  );
}
