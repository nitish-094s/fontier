import { useEffect } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { FileArchive, FileType, Folder, FolderSearch, X } from 'lucide-react';
import { useApp } from '../lib/state';
import { formatBytes, plural, timeAgo } from '../lib/api';
import { reviewPaths } from './Drop';
import type { FontCandidate } from '../lib/types';

const KIND_ICON = { zip: FileArchive, file: FileType, folder: Folder } as const;
const KIND_LABEL = { zip: 'Zip', file: 'Font file', folder: 'Folder' } as const;

/**
 * Fonts waiting in watched folders (Downloads by default). Only things that are or hold fonts
 * show here; everything else in the folder is ignored. Dismissed items stay hidden until they change.
 */
export function FontInboxDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { inbox, dismiss, refreshZips, settings } = useApp();
  useEffect(() => {
    if (isOpen) refreshZips();
  }, [isOpen, refreshZips]);

  const review = (items: FontCandidate[]) => {
    onClose();
    reviewPaths(items.map((c) => c.path));
  };
  const where = settings.watchFolders.map((f) => f.split(/[\\/]/).pop()).join(', ') || 'your watched folders';

  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && onClose()} width={680} maxHeight="82vh">
      <DialogHeader
        title={inbox.length ? `${plural(inbox.length, 'font pack')} waiting` : 'Nothing waiting'}
        subtitle={`Fonts in ${where} that aren't installed yet. Other files are ignored.`}
        onOpenChange={onClose}
      />
      <div className="inbox">
        {inbox.length === 0 && <EmptyState isCompact title="All caught up" description="New font zips, font files and font folders show up here as soon as they land." />}
        <div className="inbox-list">
          {inbox.map((c) => {
            const Icon = KIND_ICON[c.kind];
            const left = c.fonts - c.fontsInstalled;
            return (
              <div key={c.path} className="inbox-row">
                <span className="inbox-icon">
                  <Icon size={18} />
                </span>
                <div className="inbox-main">
                  <div className="inbox-families">{c.families.slice(0, 3).join(', ') || c.name}</div>
                  <div className="muted small inbox-meta" title={c.path}>
                    {KIND_LABEL[c.kind]} · {c.name} · {plural(left, 'font')} to install
                    {c.fontsInstalled ? ` (${c.fontsInstalled} already installed)` : ''} · {c.kind !== 'folder' ? `${formatBytes(c.size)} · ` : ''}
                    {timeAgo(new Date(c.modified * 1000).toISOString())}
                  </div>
                </div>
                <IconButton size="sm" variant="ghost" label="Show in Explorer" tooltip="Show in Explorer" icon={<FolderSearch size={15} />} onClick={() => revealItemInDir(c.path)} />
                <IconButton size="sm" variant="ghost" label="Dismiss" tooltip="Hide this one" icon={<X size={15} />} onClick={() => dismiss(c)} />
                <Button size="sm" label="Review" onClick={() => review([c])} />
              </div>
            );
          })}
        </div>
        {inbox.length > 1 && (
          <div className="review-footer">
            <div className="grow" />
            <Button variant="primary" label={`Review all ${inbox.length}`} onClick={() => review(inbox)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
