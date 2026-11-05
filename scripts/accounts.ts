/** Reads accounts.config.json: account groups (a person or brand) and their profile URLs. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../src/types';

export interface ConfiguredAccount {
  id: string; // "<group>-<platform>", e.g. "omg-x"; also the raw file name
  group: string;
  platform: Platform;
  url: string;
}

export interface ConfiguredGroup {
  id: string;
  name: string;
  shortName: string;
  accounts: Partial<Record<Platform, string>>;
}

export function loadConfig(): { groups: ConfiguredGroup[]; accounts: ConfiguredAccount[] } {
  const file = join(process.cwd(), 'accounts.config.json');
  const { groups } = JSON.parse(readFileSync(file, 'utf8')) as { groups: ConfiguredGroup[] };
  const accounts = groups.flatMap((g) =>
    Object.entries(g.accounts)
      .filter(([, url]) => url && url.trim())
      .map(([platform, url]) => ({ id: `${g.id}-${platform}`, group: g.id, platform: platform as Platform, url: url!.trim() })),
  );
  return { groups, accounts };
}

/** Pulls the handle out of a profile URL, e.g. https://www.tiktok.com/@acme -> acme */
export function handleFromUrl(url: string): string {
  const path = new URL(url).pathname.split('/').filter(Boolean);
  return (path[0] ?? '').replace(/^@/, '');
}
