import { useEffect, useState } from 'react';
import Header from './Header';
import PerformanceChart from './PerformanceChart';
import StatCards from './StatCards';
import Highlights from './Highlights';
import Spotlight from './Spotlight';
import TopPosts from './TopPosts';
import { PLATFORMS } from './types';
import { PLATFORM_LABEL } from './format';
import type { Platform, Snapshot } from './types';

export type Filter = Platform | 'all';

export const RANGES = [30, 14, 7, 3, 1] as const;
export type RangeDays = (typeof RANGES)[number];

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; snapshot: Snapshot };

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
  const [days, setDays] = useState<RangeDays>(30);
  // Platform shown in Top posts and Highlights; follows the filter when one is picked.
  const [focusPlatform, setFocusPlatform] = useState<Platform>('x');

  useEffect(() => {
    if (filter !== 'all') setFocusPlatform(filter);
  }, [filter]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/snapshot.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Snapshot>;
      })
      .then((snapshot) => {
        setState({ kind: 'ready', snapshot });
        const first = PLATFORMS.find((p) => snapshot.sources[p].status === 'ok');
        if (first) setFocusPlatform(first);
      })
      .catch((err) => setState({ kind: 'error', message: String(err.message ?? err) }));
  }, []);

  if (state.kind === 'loading') return <p className="status-msg">Loading snapshot…</p>;
  if (state.kind === 'error') {
    return (
      <p className="status-msg" role="alert">
        Could not load data/snapshot.json ({state.message}). Run <code>npm run refresh</code> to generate it.
      </p>
    );
  }

  const { snapshot } = state;
  const source = filter === 'all' ? null : snapshot.sources[filter];
  const unavailable = source !== null && source.status !== 'ok';

  return (
    <div className="page">
      <Header snapshot={snapshot} filter={filter} onFilter={setFilter} days={days} onDays={setDays} />
      <main>
        {unavailable ? (
          <section className="card empty">
            No {PLATFORM_LABEL[filter as Platform]} data:{' '}
            {source.status === 'missing' ? 'no account URL is configured.' : 'the last scrape failed.'}
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
            <div className="split">
              <TopPosts snapshot={snapshot} days={days} platform={focusPlatform} onPlatform={setFocusPlatform} />
              <Highlights snapshot={snapshot} platform={focusPlatform} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
