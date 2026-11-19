import { Badge } from '@astryxdesign/core/Badge';

/** Normalises license strings from fonts, zips and the online sources into one badge. */
export function licenseInfo(license: string): { label: string; variant: 'success' | 'warning' | 'neutral'; commercial: boolean | null } {
  const l = license.toLowerCase();
  if (l.includes('personal')) return { label: 'Personal use only', variant: 'warning', commercial: false };
  if (l.startsWith('ofl') || l.includes('open font')) return { label: 'Open Font License', variant: 'success', commercial: true };
  if (l.startsWith('apache')) return { label: 'Apache 2.0', variant: 'success', commercial: true };
  if (l.startsWith('ufl')) return { label: 'Ubuntu Font License', variant: 'success', commercial: true };
  if (l.includes('cc0') || l.includes('unlicense') || l === 'mit') return { label: license.toUpperCase() === 'MIT' ? 'MIT' : 'Public domain', variant: 'success', commercial: true };
  if (l.includes('commercial')) return { label: 'Free for commercial use', variant: 'success', commercial: true };
  return { label: 'License unknown', variant: 'neutral', commercial: null };
}

export function LicenseBadge({ license }: { license: string }) {
  const i = licenseInfo(license);
  return <Badge variant={i.variant} label={i.label} />;
}
