import { useEffect, useState } from 'react';
import Header from './Header';
import Highlights from './Highlights';
import PerformanceChart from './PerformanceChart';
import Spotlight from './Spotlight';
import StatCards from './StatCards';
import TopPosts from './TopPosts';
import { filterLabel } from './format';
import { ALL, filterAccountId, type Filter, type Snapshot } from './types';

export const RANGES = [90, 30, 14, 7, 3, 1] as const;
export type RangeDays = (typeof RANGES)[number];

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; snapshot: Snapshot };

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>(ALL);
  const [days, setDays] = useState<RangeDays>(30);
  // Account shown in Top posts and Highlights. It follows the filter: a single account
  // selects it; a group keeps the current one if it's in that group, else its first account.
  const [focusAccount, setFocusAccount] = useState<string>('');

  const snapshot = state.kind === 'ready' ? state.snapshot : null;
  useEffect(() => {
    if (!snapshot) return;
    const ok = snapshot.accounts.filter((a) => snapshot.sources[a.id]?.status === 'ok');
    const single = filterAccountId(filter);
    if (single) return setFocusAccount(single);
    setFocusAccount((current) => {
      const inGroup = ok.filter((a) => filter.group === 'all' || a.group === filter.group);
      return inGroup.some((a) => a.id === current) ? current : (inGroup[0]?.id ?? '');
    });
  }, [snapshot, filter]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/snapshot.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Snapshot>;
      })
      .then((data) => setState({ kind: 'ready', snapshot: data }))
      .catch((err) => setState({ kind: 'error', message: String(err.message ?? err) }));
  }, []);

  if (state.kind === 'loading') return <p className="status-msg">Loading snapshot…</p>;
  if (state.kind === 'error' || !snapshot) {
    return (
      <p className="status-msg" role="alert">
        Could not load data/snapshot.json ({state.kind === 'error' ? state.message : 'no data'}). Run{' '}
        <code>npm run refresh</code> to generate it.
      </p>
    );
  }

  const single = filterAccountId(filter);
  const source = single ? snapshot.sources[single] : null;
  const unavailable = single !== null && source?.status !== 'ok';

  return (
    <div className="page">
      <Header snapshot={snapshot} filter={filter} onFilter={setFilter} days={days} onDays={setDays} />
      <main>
        {unavailable ? (
          <section className="card empty">
            No {filterLabel(snapshot, filter)} data:{' '}
            {source ? 'the last scrape failed.' : 'this account isn’t configured.'}
          </section>
        ) : (
          <>
            {/* Stats and chart take two of three columns; Spotlight runs down the third. */}
            <div className="overview">
              <div className="overview-main">
                <StatCards snapshot={snapshot} filter={filter} days={days} />
                <PerformanceChart snapshot={snapshot} filter={filter} days={days} />
              </div>
              <Spotlight snapshot={snapshot} filter={filter} days={days} />
            </div>
            {/* Top posts takes two of three columns; Highlights fills the third. */}
            {focusAccount && (
              <div className="split">
                <TopPosts snapshot={snapshot} days={days} filter={filter} accountId={focusAccount} onAccount={setFocusAccount} />
                <Highlights snapshot={snapshot} accountId={focusAccount} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
