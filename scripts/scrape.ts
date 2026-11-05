/**
 * Scrapes public account data through Apify actors and saves the raw dataset items
 * to data/raw/<account id>.json. Accounts come from accounts.config.json. Usage:
 *   npm run scrape              # every configured account
 *   npm run scrape -- jok       # one group (all its platforms)
 *   npm run scrape -- tiktok    # one platform across groups
 *   npm run scrape -- jok-x     # one account
 */
import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../src/types';
import { handleFromUrl, loadConfig, type ConfiguredAccount } from './accounts';

/** How far back to scrape: the dashboard's 90-day window plus the 2 days insights skip. */
export const HISTORY_DAYS = 92;
/** Spend cap per actor run, so a busy account can't drain the Apify credit. */
const MAX_CHARGE_USD = 2;

interface ScrapeOptions {
  since: string; // YYYY-MM-DD, HISTORY_DAYS ago
}

interface Job {
  name: string; // key under `items` in the raw file, e.g. "posts" or "profile"
  actorId: string;
  buildInput: (url: string, opts: ScrapeOptions) => Record<string, unknown>;
  maxItems: number; // dataset items to keep (also a cost cap)
}

// ---------------------------------------------------------------------------
// Actor config: change actors or inputs here. Post jobs stop at `since` where the
// actor supports a date filter; maxItems is a safety cap on top of that.
// ---------------------------------------------------------------------------
const CONFIG: Record<Platform, Job[]> = {
  instagram: [
    {
      name: 'posts',
      actorId: 'apify/instagram-scraper',
      maxItems: 400,
      buildInput: (url, { since }) => ({
        directUrls: [url],
        resultsType: 'posts',
        resultsLimit: 400,
        onlyPostsNewerThan: since,
        addParentData: false,
      }),
    },
    {
      name: 'profile',
      actorId: 'apify/instagram-scraper',
      maxItems: 1,
      buildInput: (url) => ({ directUrls: [url], resultsType: 'details', resultsLimit: 1 }),
    },
  ],
  tiktok: [
    {
      name: 'posts',
      actorId: 'clockworks/tiktok-scraper',
      maxItems: 400,
      buildInput: (url, { since }) => ({
        profiles: [handleFromUrl(url)],
        resultsPerPage: 400,
        oldestPostDateUnified: since,
        profileScrapeSections: ['videos'],
        profileSorting: 'latest',
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSlideshowImages: false,
      }),
    },
  ],
  x: [
    {
      name: 'posts',
      // apidojo's X actors cap free-plan accounts at 10 items; this one does not.
      // Retweets (often half the timeline) are dropped in normalize.ts.
      actorId: 'xquik/x-tweet-scraper',
      maxItems: 3000,
      buildInput: (url, { since }) => ({
        mode: 'profileTweets',
        twitterHandles: [handleFromUrl(url)],
        since,
        maxItems: 3000,
        queryType: 'Latest',
      }),
    },
  ],
  facebook: [
    {
      name: 'posts',
      actorId: 'apify/facebook-posts-scraper',
      maxItems: 400,
      buildInput: (url, { since }) => ({ startUrls: [{ url }], resultsLimit: 400, onlyPostsNewerThan: since }),
    },
    {
      name: 'profile',
      actorId: 'apify/facebook-pages-scraper',
      maxItems: 1,
      buildInput: (url) => ({ startUrls: [{ url }] }),
    },
  ],
  youtube: [
    {
      name: 'posts',
      // 100 newest videos; for the accounts so far that reaches well past 90 days.
      actorId: 'streamers/youtube-scraper',
      maxItems: 100,
      buildInput: (url) => ({
        startUrls: [{ url }],
        maxResults: 100,
        maxResultsShorts: 0,
        maxResultStreams: 0,
        sortVideosBy: 'NEWEST',
      }),
    },
  ],
};

// ---------------------------------------------------------------------------

const RAW_DIR = join(process.cwd(), 'data', 'raw');

/** Shape of data/raw/<account id>.json */
export interface RawFile {
  _meta: {
    accountId: string;
    group: string;
    platform: Platform;
    url: string;
    scrapedAt: string;
    jobs: { name: string; actorId: string; runId: string; itemCount: number }[];
  };
  items: Record<string, unknown[]>;
}

function explainError(actorId: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rent|paid|subscription|trial|payment|insufficient|not allowed|403/i.test(msg)) {
    return `${actorId} could not run. It may be a paid/rental actor or your credits may be used up. Apify said: ${msg}`;
  }
  return `${actorId} failed: ${msg}`;
}

async function scrapeAccount(client: ApifyClient, account: ConfiguredAccount, opts: ScrapeOptions): Promise<void> {
  const tag = `[${account.id}]`;
  const raw: RawFile = {
    _meta: { accountId: account.id, group: account.group, platform: account.platform, url: account.url, scrapedAt: new Date().toISOString(), jobs: [] },
    items: {},
  };

  for (const job of CONFIG[account.platform]) {
    console.log(`${tag} running ${job.actorId} (${job.name})...`);
    let run, items;
    try {
      // call() starts the run and waits for it to finish.
      run = await client
        .actor(job.actorId)
        .call(job.buildInput(account.url, opts), { memory: 1024, maxTotalChargeUsd: MAX_CHARGE_USD });
      if (run.status !== 'SUCCEEDED') throw new Error(`run ${run.id} ended with status ${run.status}`);
      ({ items } = await client.dataset(run.defaultDatasetId).listItems({ limit: job.maxItems }));
    } catch (err) {
      throw new Error(explainError(job.actorId, err));
    }
    raw.items[job.name] = items;
    raw._meta.jobs.push({ name: job.name, actorId: job.actorId, runId: run.id, itemCount: items.length });
    const capped = items.length >= job.maxItems && job.maxItems > 1 ? ` (hit the ${job.maxItems}-item cap)` : '';
    console.log(`${tag} ${job.name}: ${items.length} items${capped}`);
  }

  // Write to a temp file first so a crash never leaves a half-written raw file.
  mkdirSync(RAW_DIR, { recursive: true });
  const target = join(RAW_DIR, `${account.id}.json`);
  writeFileSync(`${target}.tmp`, JSON.stringify(raw, null, 2));
  renameSync(`${target}.tmp`, target);
  console.log(`${tag} saved ${target}`);
}

async function main(): Promise<void> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    console.error('APIFY_TOKEN is not set in .env');
    process.exit(1);
  }

  const { accounts } = loadConfig();
  const arg = process.argv[2];
  const selected = arg ? accounts.filter((a) => a.id === arg || a.group === arg || a.platform === arg) : accounts;
  if (selected.length === 0) {
    console.error(`No configured account matches "${arg}". Use an account id (${accounts.map((a) => a.id).join(', ')}), a group or a platform.`);
    process.exit(1);
  }

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const client = new ApifyClient({ token });
  let failures = 0;
  for (const account of selected) {
    try {
      await scrapeAccount(client, account, { since });
    } catch (err) {
      failures++;
      console.error(`[${account.id}] ${err instanceof Error ? err.message : err}`);
      console.error(`[${account.id}] previous raw file (if any) was kept.`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

main();
