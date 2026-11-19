import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Dialog } from '@astryxdesign/core/Dialog';
import { DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Banner } from '@astryxdesign/core/Banner';
import { UploadCloud, FolderOpen, FileArchive } from 'lucide-react';
import { api, plural } from '../lib/api';
import { useApp } from '../lib/state';
import { useFont } from '../lib/fontLoader';
import type { FoundFont, ScanResult } from '../lib/types';
import { LicenseBadge } from './LicenseBadge';

// ---------------------------------------------------------------- tiny shared store
type DropState = { hovering: boolean; scanning: boolean; result: ScanResult | null; label: string };
let state: DropState = { hovering: false, scanning: false, result: null, label: '' };
const subs = new Set<() => void>();
const set = (p: Partial<DropState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};
const useDrop = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

export async function reviewPaths(paths: string[]) {
  if (!paths.length) return;
  const name = paths.length === 1 ? paths[0].split(/[\\/]/).pop() ?? '' : plural(paths.length, 'item');
  set({ scanning: true, result: null, label: name });
  try {
    const result = await api.scanPaths(paths);
    set({ scanning: false, result });
  } catch (e) {
    set({ scanning: false, result: { fonts: [], license: 'Unknown', skipped: [String(e)] } });
  }
}

export async function browseForFonts() {
  const picked = await openDialog({ multiple: true, filters: [{ name: 'Fonts and zips', extensions: ['ttf', 'otf', 'ttc', 'otc', 'zip'] }] });
  if (picked) reviewPaths(Array.isArray(picked) ? picked : [picked]);
}

export async function browseForFolder() {
  const picked = await openDialog({ directory: true });
  if (typeof picked === 'string') reviewPaths([picked]);
}

/** Mounted once: listens for files dragged onto the window from Explorer. */
export function DropController() {
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'enter' || e.payload.type === 'over') set({ hovering: true });
      else if (e.payload.type === 'leave') set({ hovering: false });
      else if (e.payload.type === 'drop') {
        set({ hovering: false });
        reviewPaths(e.payload.paths);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);
  const s = useDrop();
  return (
    <>
      {s.hovering && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <UploadCloud size={36} />
            <div>Drop to review fonts</div>
          </div>
        </div>
      )}
      <ReviewDialog />
    </>
  );
}

export function DropZone() {
  const s = useDrop();
  return (
    <div className={`dropzone ${s.hovering ? 'is-hover' : ''}`}>
      <div className="dropzone-icon">
        <UploadCloud size={34} />
      </div>
      <div className="dropzone-title">Drop fonts to install</div>
      <div className="dropzone-sub">Font files, .zip font packs or whole folders. You'll review before anything installs.</div>
      <div className="dropzone-actions">
        <Button size="lg" label="Browse files" icon={<FileArchive size={16} />} onClick={browseForFonts} />
        <Button size="lg" label="Choose folder" variant="ghost" icon={<FolderOpen size={16} />} onClick={browseForFolder} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- review sheet
interface FamilyGroup {
  family: string;
  fonts: FoundFont[];
  installed: boolean;
}

function FamilyPreview({ font, text }: { font: FoundFont; text: string }) {
  const { family } = useFont({ kind: 'file', path: font.file });
  return (
    <div className="review-sample" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined, opacity: family ? 1 : 0.35 }}>
      {text}
    </div>
  );
}

function ReviewDialog() {
  const s = useDrop();
  const { installFiles, settings, updateSettings } = useApp();
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const isOpen = s.scanning || !!s.result;

  const groups = useMemo<FamilyGroup[]>(() => {
    const map = new Map<string, FoundFont[]>();
    for (const f of s.result?.fonts ?? []) {
      const fam = f.faces[0].family;
      map.set(fam, [...(map.get(fam) ?? []), f]);
    }
    return [...map.entries()].map(([family, fonts]) => ({ family, fonts, installed: fonts.every((f) => f.installed) }));
  }, [s.result]);

  useEffect(() => {
    setUnchecked(new Set(groups.filter((g) => g.installed).map((g) => g.family)));
  }, [groups]);

  const chosen = groups.filter((g) => !unchecked.has(g.family));
  const fileCount = chosen.reduce((a, g) => a + g.fonts.filter((f) => !f.installed).length, 0);
  const close = () => set({ result: null, scanning: false });
  const personal = s.result?.license === 'Personal use only';

  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && !busy && close()} width={720} maxHeight="86vh" purpose="form">
      <DialogHeader
        title={s.scanning ? `Looking inside ${s.label}…` : groups.length ? `${plural(groups.length, 'family', 'families')} found` : 'No fonts found'}
        subtitle={s.result ? `${plural(s.result.fonts.length, 'font file')} from ${s.label}` : undefined}
        onOpenChange={() => !busy && close()}
        endContent={s.result && groups.length ? <LicenseBadge license={s.result.license} /> : undefined}
      />
      {s.scanning && (
        <div className="review-loading">
          <Spinner size="lg" />
        </div>
      )}
      {s.result && (
        <div className="review-body">
          {personal && (
            <Banner
              status="warning"
              title="Personal use only"
              description="The license that came with these fonts doesn't allow commercial work (ads, branding, client projects). Check before using them in commercial projects."
            />
          )}
          {groups.length === 0 && <div className="muted">Nothing installable was found{s.result.skipped.length ? `: ${s.result.skipped.slice(0, 3).join(', ')}` : '.'}</div>}
          <div className="review-list">
            {groups.map((g) => (
              <div key={g.family} className={`review-row ${unchecked.has(g.family) ? 'is-off' : ''}`}>
                <CheckboxInput
                  label={`Install ${g.family}`}
                  isLabelHidden
                  value={!unchecked.has(g.family)}
                  onChange={(v) =>
                    setUnchecked((prev) => {
                      const n = new Set(prev);
                      if (v) n.delete(g.family);
                      else n.add(g.family);
                      return n;
                    })
                  }
                />
                <div className="review-main">
                  <div className="review-head">
                    <span className="review-family">{g.family}</span>
                    <span className="muted small">{plural(g.fonts.length, 'style')}</span>
                    {g.installed && <span className="chip ok">Installed</span>}
                    {!g.installed && g.fonts.some((f) => f.installed) && <span className="chip">Partly installed</span>}
                  </div>
                  <FamilyPreview font={g.fonts.find((f) => /regular/i.test(f.faces[0].style)) ?? g.fonts[0]} text={g.family} />
                  <div className="review-styles">
                    {g.fonts.slice(0, 14).map((f) => (
                      <span key={f.file} className={`chip ${f.installed ? 'ok' : ''}`}>
                        {f.faces[0].style}
                      </span>
                    ))}
                    {g.fonts.length > 14 && <span className="chip">+{g.fonts.length - 14}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {s.result.skipped.length > 0 && groups.length > 0 && <div className="muted small">Skipped (not fonts): {s.result.skipped.slice(0, 6).join(', ')}{s.result.skipped.length > 6 ? '…' : ''}</div>}
          {groups.length > 0 && (
            <div className="review-footer">
              <SegmentedControl label="Install for" value={settings.scope} onChange={(v) => updateSettings({ scope: v as 'user' | 'machine' })} size="sm">
                <SegmentedControlItem value="user" label="Just me" />
                <SegmentedControlItem value="machine" label="Everyone (admin)" />
              </SegmentedControl>
              <div className="grow" />
              <Button label="Cancel" variant="ghost" onClick={close} isDisabled={busy} />
              <Button
                label={fileCount ? `Install ${plural(fileCount, 'font')}` : 'Nothing new to install'}
                variant="primary"
                isDisabled={!fileCount}
                isLoading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const files = chosen.flatMap((g) => g.fonts.filter((f) => !f.installed).map((f) => f.file));
                    await installFiles(files, chosen.length === 1 ? chosen[0].family : plural(chosen.length, 'family', 'families'));
                    close();
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
