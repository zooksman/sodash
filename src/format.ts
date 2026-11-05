import type { Platform } from './types';

export const PLATFORM_LABEL: Record<Platform, string> = {
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

/** Platform accent, defined once in styles.css. Usable as a CSS or SVG color. */
export const platformColor = (p: Platform) => `var(--c-${p})`;

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function fmtNumber(n: number | null): string {
  if (n === null) return '—';
  return n < 1000 ? String(Math.round(n * 10) / 10) : compact.format(n);
}

export function fmtPct(n: number | null, digits = 1): string {
  return n === null ? '—' : `${n.toFixed(digits)}%`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function rangeLabel(days: number): string {
  return days === 1 ? 'last 24 hours' : `last ${days} days`;
}

/** Morning before noon, afternoon until 6pm, evening after — in the viewer's local time. */
export function greeting(date: Date): string {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
