import { useMemo, useState } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Heading } from '@astryxdesign/core/Heading';
import { ArrowUpRight, Copy, Trash2 } from 'lucide-react';
import { useApp } from '../lib/state';
import { formatBytes, plural, timeAgo } from '../lib/api';
import { useFont, useInView } from '../lib/fontLoader';
import { DropZone } from '../components/Drop';
import { FontInboxDialog } from '../components/FontInbox';
import type { InstalledFont, RecentFamily } from '../lib/types';

/** A stat tile. With onClick the whole tile is the button. */
function Stat({
  value,
  label,
  sub,
  onClick,
  className = 'panel',
  children,
}: {
  value: string;
  label: string;
  sub?: string;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="stat-head">
        <span>{label}</span>
        {onClick && <ArrowUpRight size={17} className="stat-arrow" aria-hidden="true" />}
      </span>
      <span className="doto">{value}</span>
      <span className="stat-foot">
        <span className={className === 'panel' ? 'muted' : undefined}>{sub}</span>
        {children}
      </span>
    </>
  );
  return onClick ? (
    <button className={`stat-tile is-button ${className}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`stat-tile ${className}`}>{body}</div>
  );
}

/** One family in Recently installed, whichever way it got onto the PC. */
interface RecentItem {
  family: string;
  files: string[];
  styles: number;
  date: string;
  removable: boolean;
  source: string;
  catalogId?: string;
}

const SOURCE_NAME: Record<RecentFamily['source'], string> = {
  drop: 'Added with Fontier',
  google: 'Google Fonts',
  fontsource: 'Fontsource',
  fontsquirrel: 'Font Squirrel',
};

/**
 * The 20 most recently installed families on this PC, from file creation times, so fonts
 * installed outside Fontier (right-click › Install, other apps) count too. Fonts that shipped
 * with Windows (owned by TrustedInstaller, including Windows-update replacements) are left out.
 */
function useRecentFamilies(installed: InstalledFont[], appRecents: RecentFamily[]): RecentItem[] {
  return useMemo(() => {
    const byFamily = new Map<string, { files: InstalledFont[]; created: number; styles: Set<string> }>();
    for (const f of installed) {
      if (!f.enabled || !f.created) continue;
      if (f.osFont) continue; // shipped with Windows, not installed by anyone
      for (const fam of new Set(f.faces.map((x) => x.family))) {
        const e = byFamily.get(fam) ?? { files: [], created: 0, styles: new Set<string>() };
        e.files.push(f);
        e.created = Math.max(e.created, f.created);
        f.faces.filter((x) => x.family === fam).forEach((x) => e.styles.add(x.style));
        byFamily.set(fam, e);
      }
    }
    const meta = new Map(appRecents.map((r) => [r.family.toLowerCase(), r]));
    return [...byFamily.entries()]
      .sort((a, b) => b[1].created - a[1].created)
      .slice(0, 20)
      .map(([family, e]) => {
        const m = meta.get(family.toLowerCase());
        const removable = e.files.every((f) => f.scope === 'user');
        const regular = e.files.find((f) => f.faces.some((x) => x.family === family && /^regular$/i.test(x.style))) ?? e.files[0];
        return {
          family,
          files: [regular.path, ...e.files.filter((f) => f !== regular).map((f) => f.path)],
          styles: e.styles.size,
          date: new Date(e.created * 1000).toISOString(),
          removable,
          source: m ? SOURCE_NAME[m.source] : removable ? 'Installed outside Fontier' : 'Installed for all users',
          catalogId: m?.catalogId,
        };
      });
  }, [installed, appRecents]);
}

function RecentCard({ r }: { r: RecentItem }) {
  const { openManage, uninstallPaths, openFamily } = useApp();
  const { ref, seen } = useInView<HTMLDivElement>();
  const isCollection = /\.(ttc|otc)$/i.test(r.files[0] ?? '');
  const { family } = useFont(r.files[0] ? (isCollection ? { kind: 'local', family: r.family } : { kind: 'file', path: r.files[0] }) : null, seen);
  const [copied, setCopied] = useState(false);
  return (
    <div className="recent-card" ref={ref}>
      <div className="recent-sample" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined }}>
        {r.family}
      </div>
      <div className="recent-meta">
        <span>{plural(r.styles, 'style')}</span>
        <span className="dot" />
        <span>{r.source}</span>
        <span className="dot" />
        <span>{timeAgo(r.date)}</span>
      </div>
      <div className="recent-actions">
        <IconButton
          size="sm"
          variant="ghost"
          label={copied ? 'Copied' : 'Copy name'}
          tooltip={copied ? 'Copied' : 'Copy font name'}
          icon={<Copy size={15} />}
          onClick={() => {
            navigator.clipboard.writeText(r.family);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        />
        <IconButton size="sm" variant="ghost" label="Open" tooltip="Open in Manage" icon={<ArrowUpRight size={15} />} onClick={() => (r.catalogId ? openFamily(r.catalogId) : openManage(r.family))} />
        {r.removable && <IconButton size="sm" variant="ghost" label="Uninstall" tooltip="Uninstall" icon={<Trash2 size={15} />} onClick={() => uninstallPaths(r.files, r.family)} />}
      </div>
    </div>
  );
}

export function HomePage() {
  const { installed, recents: appRecents, installedFamilies, go, inbox } = useApp();
  const recents = useRecentFamilies(installed, appRecents);
  const [inboxOpen, setInboxOpen] = useState(false);

  const families = installedFamilies.size;
  const weekAgo = Date.now() - 7 * 86400 * 1000;
  const addedThisWeek = recents.filter((r) => new Date(r.date).getTime() > weekAgo).length;
  const userBytes = useMemo(() => installed.filter((f) => f.scope === 'user').reduce((a, f) => a + f.size, 0), [installed]);
  const userFamilies = useMemo(() => {
    const s = new Set<string>();
    for (const f of installed) if (f.scope === 'user') for (const face of f.faces) s.add(face.family);
    return s.size;
  }, [installed]);
  const [size, unit] = formatBytes(userBytes).split(' ');
  const packName = (c: (typeof inbox)[number]) => (c.kind === 'file' ? (c.families[0] ?? c.name) : c.name.replace(/\.zip$/i, '').replace(/-\d{4}-\d{2}-\d{2}-.*$/, ''));
  const waitingSub = inbox.length ? `${packName(inbox[0])}${inbox.length > 1 ? ` +${inbox.length - 1} more` : ''}` : 'All caught up';

  return (
    <div className="home">
      <section className="home-main">
        <DropZone />
      </section>

      <section className="stat-row">
        <Stat className="glow-card" value={families.toLocaleString()} label="Families on this PC" sub={addedThisWeek ? `+${addedThisWeek} this week` : 'Ready in every app'} onClick={() => go('manage')} />
        <Stat value={String(inbox.length)} label="Fonts waiting" sub={waitingSub} onClick={() => setInboxOpen(true)} />
        <Stat value={String(addedThisWeek)} label="Added this week" sub={addedThisWeek ? plural(addedThisWeek, 'family', 'families') : 'Nothing new yet'} />
        <Stat value={size} label={`${unit} of your fonts`} sub={`${plural(userFamilies, 'family', 'families')} you added`} />
      </section>

      <section className="recents">
        <div className="section-head">
          <Heading level={2}>Recently installed</Heading>
        </div>
        {recents.length === 0 ? (
          <div className="empty-line">
            Fonts you install show up here. Try{' '}
            <button className="link" onClick={() => go('discover')}>
              Discover
            </button>{' '}
            to browse thousands of free families.
          </div>
        ) : (
          <div className="recent-grid">
            {recents.map((r) => (
              <RecentCard key={r.family + r.date} r={r} />
            ))}
          </div>
        )}
      </section>
      <FontInboxDialog isOpen={inboxOpen} onClose={() => setInboxOpen(false)} />
    </div>
  );
}
