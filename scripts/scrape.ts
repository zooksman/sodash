/**
 * Scrapes public account data through Apify actors and saves the raw dataset items
 * to data/raw/<platform>.json. Usage:
 *   npm run scrape            # all platforms with a URL set in .env
 *   npm run scrape -- tiktok  # one platform
 */
import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../src/types';

const MAX_ITEMS = 100;
const X_RAW_ITEMS = 500;

interface Job {
  name: string; // key under `items` in the raw file, e.g. "posts" or "profile"
  actorId: string;
  buildInput: (url: string) => Record<string, unknown>;
  maxItems?: number; // dataset items to keep; defaults to MAX_ITEMS
}

interface PlatformConfig {
  envVar: string;
  jobs: Job[];
}

/** Pulls the handle out of a profile URL, e.g. https://www.tiktok.com/@acme -> acme */
function handleFromUrl(url: string): string {
  const path = new URL(url).pathname.split('/').filter(Boolean);
  return (path[0] ?? '').replace(/^@/, '');
}

// ---------------------------------------------------------------------------
// Actor config: change actors or inputs here.
// ---------------------------------------------------------------------------
const CONFIG: Record<Platform, PlatformConfig> = {
  instagram: {
    envVar: 'INSTAGRAM_URL',
    jobs: [
      {
        name: 'posts',
        actorId: 'apify/instagram-scraper',
        buildInput: (url) => ({ directUrls: [url], resultsType: 'posts', resultsLimit: MAX_ITEMS, addParentData: false }),
      },
      {
        name: 'profile',
        actorId: 'apify/instagram-scraper',
        buildInput: (url) => ({ directUrls: [url], resultsType: 'details', resultsLimit: 1 }),
      },
    ],
  },
  tiktok: {
    envVar: 'TIKTOK_URL',
    jobs: [
      {
        name: 'posts',
        actorId: 'clockworks/tiktok-scraper',
        buildInput: (url) => ({
          profiles: [handleFromUrl(url)],
          resultsPerPage: MAX_ITEMS,
          profileScrapeSections: ['videos'],
          profileSorting: 'latest',
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
          shouldDownloadSlideshowImages: false,
        }),
      },
    ],
  },
  x: {
    envVar: 'X_URL',
    jobs: [
      {
        name: 'posts',
        // apidojo's X actors cap free-plan accounts at 10 items; this one does not.
        // ~50% of the timeline is retweets (dropped in normalize.ts) and the account posts
        // ~25x/week, so fetch extra to cover the 60 days the dashboard compares.
        actorId: 'xquik/x-tweet-scraper',
        maxItems: X_RAW_ITEMS,
        buildInput: (url) => ({
          mode: 'profileTweets',
          twitterHandles: [handleFromUrl(url)],
          maxItems: X_RAW_ITEMS,
          queryType: 'Latest',
        }),
      },
    ],
  },
  facebook: {
    envVar: 'FACEBOOK_URL',
    jobs: [
      {
        name: 'posts',
        actorId: 'apify/facebook-posts-scraper',
        buildInput: (url) => ({ startUrls: [{ url }], resultsLimit: MAX_ITEMS }),
      },
      {
        name: 'profile',
        actorId: 'apify/facebook-pages-scraper',
        buildInput: (url) => ({ startUrls: [{ url }] }),
      },
    ],
  },
  youtube: {
    envVar: 'YOUTUBE_URL',
    jobs: [
      {
        name: 'posts',
        actorId: 'streamers/youtube-scraper',
        buildInput: (url) => ({ startUrls: [{ url }], maxResults: MAX_ITEMS, maxResultsShorts: 0, maxResultStreams: 0, sortVideosBy: 'NEWEST' }),
      },
    ],
  },
};

// ---------------------------------------------------------------------------

const RAW_DIR = join(process.cwd(), 'data', 'raw');

/** Shape of data/raw/<platform>.json */
export interface RawFile {
  _meta: {
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

async function scrapePlatform(client: ApifyClient, platform: Platform): Promise<void> {
  const { envVar, jobs } = CONFIG[platform];
  const url = process.env[envVar]?.trim();
  if (!url) {
    console.log(`[${platform}] skipped: ${envVar} is not set`);
    return;
  }

  const raw: RawFile = {
    _meta: { platform, url, scrapedAt: new Date().toISOString(), jobs: [] },
    items: {},
  };

  for (const job of jobs) {
    console.log(`[${platform}] running ${job.actorId} (${job.name})...`);
    let run, items;
    try {
      // call() starts the run and waits for it to finish.
      run = await client.actor(job.actorId).call(job.buildInput(url), { memory: 1024 });
      if (run.status !== 'SUCCEEDED') throw new Error(`run ${run.id} ended with status ${run.status}`);
      ({ items } = await client.dataset(run.defaultDatasetId).listItems({ limit: job.maxItems ?? MAX_ITEMS }));
    } catch (err) {
      throw new Error(explainError(job.actorId, err));
    }
    raw.items[job.name] = items;
    raw._meta.jobs.push({ name: job.name, actorId: job.actorId, runId: run.id, itemCount: items.length });
    console.log(`[${platform}] ${job.name}: ${items.length} items`);
  }

  // Write to a temp file first so a crash never leaves a half-written raw file.
  mkdirSync(RAW_DIR, { recursive: true });
  const target = join(RAW_DIR, `${platform}.json`);
  writeFileSync(`${target}.tmp`, JSON.stringify(raw, null, 2));
  renameSync(`${target}.tmp`, target);
  console.log(`[${platform}] saved ${target}`);
}

async function main(): Promise<void> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    console.error('APIFY_TOKEN is not set in .env');
    process.exit(1);
  }

  const arg = process.argv[2] as Platform | undefined;
  if (arg && !(arg in CONFIG)) {
    console.error(`Unknown platform "${arg}". Use one of: ${Object.keys(CONFIG).join(', ')}`);
    process.exit(1);
  }
  const platforms = arg ? [arg] : (Object.keys(CONFIG) as Platform[]);

  const client = new ApifyClient({ token });
  let failures = 0;
  for (const platform of platforms) {
    try {
      await scrapePlatform(client, platform);
    } catch (err) {
      failures++;
      console.error(`[${platform}] ${err instanceof Error ? err.message : err}`);
      console.error(`[${platform}] previous raw file (if any) was kept.`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

main();
