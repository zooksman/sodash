import type { ReactNode } from 'react';
import { RANGES, type RangeDays } from './App';
import { fmtDate, fmtDateTime, greeting, PLATFORM_LABEL, platformColor, rangeLabel } from './format';
import { ALL, sameFilter, type Filter, type Platform, type Snapshot } from './types';

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  onFilter: (f: Filter) => void;
  days: RangeDays;
  onDays: (d: RangeDays) => void;
}

export default function Header({ snapshot, filter, onFilter, days, onDays }: Props) {
  // A plain function (not a component) so the buttons keep their identity, and focus, across renders.
  const chip = (key: string, f: Filter, children: ReactNode, className = 'chip') => (
    <button key={key} type="button" className={className} aria-pressed={sameFilter(filter, f)} onClick={() => onFilter(f)}>
      {children}
    </button>
  );

  return (
    <header className="header">
      <div>
        <h1>{greeting(new Date())}, James</h1>
        <p className="subtitle">Let's see how your social media posts are performing.</p>
        <p className="muted">Snapshot generated {fmtDateTime(snapshot.generatedAt)}</p>
      </div>

      <div className="segmented" role="group" aria-label="Time range">
        {RANGES.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => onDays(d)} aria-label={rangeLabel(d)}>
            {d === 1 ? '1 day' : `${d} days`}
          </button>
        ))}
      </div>

      {/* Account filter: everything, a whole group, or one account (group + platform). */}
      <div className="account-filter" role="group" aria-label="Filter by account">
        {chip('all', ALL, 'All accounts')}
        {snapshot.groups.map((g) => {
          const accounts = snapshot.accounts.filter((a) => a.group === g.id);
          return (
            <div key={g.id} className="account-group" role="group" aria-label={g.name}>
              {chip(g.id, { group: g.id, platform: 'all' }, g.name, 'chip chip-group')}
              {accounts.map((a) =>
                chip(
                  a.id,
                  { group: g.id, platform: a.platform },
                  <>
                    <span className="dot" style={{ background: platformColor(a.platform) }} aria-hidden />
                    <span className="visually-hidden">{g.shortName} </span>
                    {PLATFORM_LABEL[a.platform]}
                  </>,
                ),
              )}
            </div>
          );
        })}
      </div>

      <ScrapeDates snapshot={snapshot} />
    </header>
  );
}

/** "Last scraped" per group: one date when all its accounts match, otherwise each account. */
function ScrapeDates({ snapshot }: { snapshot: Snapshot }) {
  return (
    <ul className="scraped">
      {snapshot.groups.map((g) => {
        const accounts = snapshot.accounts.filter((a) => a.group === g.id);
        const configured = Object.entries(snapshot.sources).filter(([id]) => id.startsWith(`${g.id}-`));
        const failed = configured
          .filter(([, s]) => s.status !== 'ok')
          .map(([id]) => PLATFORM_LABEL[id.slice(g.id.length + 1) as Platform] ?? id);
        const dates = [...new Set(accounts.map((a) => fmtDate(snapshot.sources[a.id]?.scrapedAt ?? null)))];
        return (
          <li key={g.id}>
            <strong>{g.shortName}</strong>{' '}
            {dates.length === 1
              ? `scraped ${dates[0]}`
              : accounts.map((a) => `${PLATFORM_LABEL[a.platform]} ${fmtDate(snapshot.sources[a.id]?.scrapedAt ?? null)}`).join(' · ')}
            {failed.length > 0 && <span className="warn"> · failed: {failed.join(', ')}</span>}
          </li>
        );
      })}
    </ul>
  );
}
