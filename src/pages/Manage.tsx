import { memo, useEffect, useMemo, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Search, Plus, FolderSearch, Copy, Lock, FolderPlus, Download, Trash2, RefreshCw, Check, ArrowUpRight, X } from 'lucide-react';
import { useApp } from '../lib/state';
import { api, formatBytes, plural } from '../lib/api';
import { useFont, useInView, type FontSource } from '../lib/fontLoader';
import { licenseInfo } from '../components/LicenseBadge';
import { SlidingTabs } from '../components/SlidingTabs';
import type { InstalledFont } from '../lib/types';

interface FamilyRow {
  family: string;
  files: InstalledFont[];
  styles: string[];
  system: boolean;
  size: number;
  duplicate: boolean;
  conflict: boolean;
  catalogId?: string;
}

type Filter = 'all' | 'mine' | 'windows' | 'duplicates';

function buildRows(installed: InstalledFont[], appInstalls: Record<string, { family: string }>): FamilyRow[] {
  // A .ttc can hold several families (Cambria + Cambria Math), so a file can appear under more than one family.
  const map = new Map<string, InstalledFont[]>();
  for (const f of installed) {
    if (!f.enabled) continue;
    for (const fam of new Set(f.faces.map((x) => x.family))) map.set(fam, [...(map.get(fam) ?? []), f]);
  }
  const byFamily = new Map(Object.entries(appInstalls).map(([id, v]) => [v.family.toLowerCase(), id]));
  return [...map.entries()]
    .map(([family, files]) => {
      const faceCount = new Map<string, string[]>();
      for (const f of files) for (const face of f.faces.filter((x) => x.family === family)) faceCount.set(face.style, [...(faceCount.get(face.style) ?? []), face.version]);
      const dupes = [...faceCount.values()].filter((v) => v.length > 1);
      return {
        family,
        files,
        styles: [...faceCount.keys()],
        system: files.some((f) => f.scope === 'system'),
        size: files.reduce((a, f) => a + f.size, 0),
        duplicate: dupes.length > 0,
        conflict: dupes.some((v) => new Set(v).size > 1),
        catalogId: byFamily.get(family.toLowerCase()),
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** Best file to preview a family with: Regular if there is one. */
function previewSource(row: FamilyRow): FontSource | null {
  const first = row.files.find((f) => f.faces.some((x) => x.family === row.family && x.style.toLowerCase() === 'regular')) ?? row.files[0];
  const isCollection = /\.(ttc|otc)$/i.test(first.path);
  // Windows fonts and .ttc collections are already known to the app by name.
  if (row.system || isCollection) return { kind: 'local', family: row.family };
  return { kind: 'file', path: first.path };
}

const FamilyTile = memo(function FamilyTile({
  row,
  checked,
  selecting,
  onCheck,
  onOpen,
  text,
}: {
  row: FamilyRow;
  checked: boolean;
  selecting: boolean;
  onCheck: (v: boolean) => void;
  onOpen: () => void;
  text: string;
}) {
  const { ref, seen } = useInView<HTMLDivElement>('600px');
  const { family } = useFont(previewSource(row), seen);
  const lic = licenseInfo(row.files[0].faces[0].license);
  return (
    <div className={`font-card m-tile ${checked ? 'is-checked' : ''}`} ref={ref}>
      {/* While anything is selected, clicking a tile toggles it (like a photo grid); otherwise it opens details. */}
      <button className="font-card-hit" aria-label={selecting ? `Select ${row.family}` : `Details for ${row.family}`} onClick={() => (selecting ? onCheck(!checked) : onOpen())} />
      <button className={`select-circle ${checked ? 'on' : ''}`} role="checkbox" aria-checked={checked} aria-label={`Select ${row.family}`} onClick={() => onCheck(!checked)}>
        <Check size={13} strokeWidth={3} />
      </button>
      <div className="font-card-head">
        <div className="font-card-name">
          {row.family}
          {row.system && <Lock size={12} className="muted" aria-label="Windows font" />}
        </div>
        <div className="font-card-meta">
          {plural(row.styles.length, 'style')} · {row.system ? 'Windows' : 'Added by you'} · {formatBytes(row.size)}
        </div>
      </div>
      <div className={`font-card-sample ${family ? 'is-loaded' : ''}`} style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined }}>
        {text}
      </div>
      <div className="font-card-foot">
        {row.conflict ? <span className="chip warn">Version conflict</span> : row.duplicate && <span className="chip">Duplicate</span>}
        {lic.commercial === false && <span className="chip warn">Personal use</span>}
      </div>
    </div>
  );
});

function FamilyDetails({ row, onClose }: { row: FamilyRow | null; onClose: () => void }) {
  const { uninstallPaths, openFamily, previewText } = useApp();
  const { family } = useFont(row ? previewSource(row) : null);
  const [copied, setCopied] = useState(false);
  if (!row) return null;
  const faces = row.files.flatMap((f) => f.faces.filter((x) => x.family === row.family).map((face) => ({ face, file: f })));
  const license = row.files[0].faces[0].license;
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={720} maxHeight="86vh">
      <DialogHeader title={row.family} subtitle={`${plural(row.styles.length, 'style')} · ${row.system ? 'Windows font' : 'Added by you'} · ${formatBytes(row.size)}`} onOpenChange={onClose} />
      <div className="details">
        <div className="details-sample" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined }}>
          {previewText}
        </div>
        <div className="m-actions">
          <Button
            size="sm"
            variant="ghost"
            label={copied ? 'Copied' : 'Copy name'}
            icon={<Copy size={14} />}
            onClick={() => {
              navigator.clipboard.writeText(row.family);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          />
          <Button size="sm" variant="ghost" label="Show in Explorer" icon={<FolderSearch size={14} />} onClick={() => revealItemInDir(row.files[0].path)} />
          {row.catalogId && (
            <Button
              size="sm"
              variant="ghost"
              label="Open in Discover"
              icon={<ArrowUpRight size={14} />}
              onClick={() => {
                onClose();
                openFamily(row.catalogId!);
              }}
            />
          )}
          <div className="grow" />
          {!row.system && (
            <Button
              size="sm"
              variant="destructive"
              label="Uninstall"
              icon={<Trash2 size={14} />}
              clickAction={async () => {
                await uninstallPaths(row.files.map((f) => f.path), row.family);
                onClose();
              }}
            />
          )}
        </div>
        {row.system && <div className="muted small">Windows fonts are part of the system and can't be uninstalled here.</div>}
        <div className="m-files">
          {faces.map(({ face, file }) => (
            <div key={file.path + face.index} className="m-file">
              <span>{face.style}</span>
              <span className="muted">{face.version.replace(/^Version\s*/i, 'v')}</span>
              <span className="muted">{face.designer}</span>
              <span className="muted path" title={file.path}>
                {file.path}
              </span>
            </div>
          ))}
        </div>
        {license && <div className="muted small license-text">{license.slice(0, 320)}</div>}
      </div>
    </Dialog>
  );
}

export function ManagePage() {
  const { installed, installedLoading, refreshInstalled, appInstalls, collections, saveCollections, manageFocus, previewText, uninstallPaths } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [collection, setCollection] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  useEffect(() => {
    if (manageFocus) {
      setQuery(manageFocus);
      setFilter('all');
      setCollection(null);
      setDetails(manageFocus);
    }
  }, [manageFocus]);

  const rows = useMemo(() => buildRows(installed, appInstalls), [installed, appInstalls]);
  const counts = useMemo(
    () => ({
      all: rows.length,
      mine: rows.filter((r) => !r.system).length,
      windows: rows.filter((r) => r.system).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    }),
    [rows],
  );
  const coll = collections.find((c) => c.id === collection);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (coll && !coll.families.includes(r.family)) return false;
      if (filter === 'mine' && r.system) return false;
      if (filter === 'windows' && !r.system) return false;
      if (filter === 'duplicates' && !r.duplicate) return false;
      return !q || r.family.toLowerCase().includes(q);
    });
  }, [rows, query, filter, coll]);

  const selectedRows = rows.filter((r) => checked.has(r.family));
  const removable = selectedRows.filter((r) => !r.system);
  const allVisibleChecked = visible.length > 0 && visible.every((r) => checked.has(r.family));
  const toggle = (family: string, v: boolean) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (v) n.add(family);
      else n.delete(family);
      return n;
    });

  const addToCollection = (id: string) => {
    saveCollections(collections.map((c) => (c.id === id ? { ...c, families: [...new Set([...c.families, ...checked])] } : c)));
  };
  const exportFamilies = async (fams: FamilyRow[], name: string) => {
    const dest = await save({ defaultPath: `${name}.zip`, filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (dest) await api.exportZip(fams.flatMap((r) => r.files.map((f) => f.path)), dest);
  };

  const FILTERS: [Filter, string][] = [
    ['all', 'All'],
    ['mine', 'Added by you'],
    ['windows', 'Windows'],
    ['duplicates', 'Duplicates'],
  ];

  return (
    <div className="manage-page">
      <div className="m-toolbar">
        <div className="m-toolbar-inner">
        <div className="m-filters">
          <SlidingTabs label="Show" size="sm" items={FILTERS.map(([id, label]) => ({ id, label, count: counts[id] }))} value={filter} onChange={(id) => setFilter(id as Filter)} />
          <div className="grow" />
          <TextInput label="Filter fonts" isLabelHidden size="sm" value={query} onChange={setQuery} placeholder="Filter by name" hasClear startIcon={Search} width={240} />
          <IconButton label="Refresh" tooltip="Rescan fonts" variant="ghost" size="sm" icon={<RefreshCw size={15} />} clickAction={async () => void (await refreshInstalled())} />
        </div>
        </div>
      </div>

      {/* Appears only while tiles are selected; floats at the bottom so the grid never shifts. */}
      {checked.size > 0 && (
        <div className="selection-bar">
          <button className={`select-circle inline ${allVisibleChecked ? 'on' : ''}`} role="checkbox" aria-checked={allVisibleChecked} aria-label="Select all" onClick={() => setChecked(allVisibleChecked ? new Set() : new Set(visible.map((r) => r.family)))}>
            <Check size={13} strokeWidth={3} />
          </button>
          <span className="small selection-count">{plural(checked.size, 'family', 'families')} selected</span>
          <DropdownMenu
            placement="above"
            button={{ label: 'Add to collection', size: 'sm', variant: 'ghost', icon: <FolderPlus size={14} /> }}
            items={collections.length ? collections.map((c) => ({ label: c.name, onClick: () => addToCollection(c.id) })) : [{ label: 'Create a collection first', isDisabled: true }]}
          />
          <Button size="sm" variant="ghost" label="Export zip" icon={<Download size={14} />} onClick={() => exportFamilies(selectedRows, 'fonts')} />
          {coll && <Button size="sm" variant="ghost" label="Remove from collection" onClick={() => saveCollections(collections.map((c) => (c.id === coll.id ? { ...c, families: c.families.filter((f) => !checked.has(f)) } : c)))} />}
          <Button
            size="sm"
            variant="destructive"
            label={removable.length === selectedRows.length || removable.length === 0 ? 'Uninstall' : `Uninstall ${removable.length}`}
            icon={<Trash2 size={14} />}
            isDisabled={!removable.length}
            tooltip={removable.length < selectedRows.length ? 'Windows fonts are skipped' : undefined}
            onClick={() => setConfirm(removable.map((r) => r.family))}
          />
          <IconButton size="sm" variant="ghost" label="Clear selection" tooltip="Clear selection" icon={<X size={15} />} onClick={() => setChecked(new Set())} />
        </div>
      )}
    <div className="manage">
      <aside className="m-side">
        <div className="side-title">Library</div>
        <button className={`side-item ${!collection ? 'on' : ''}`} onClick={() => setCollection(null)}>
          All fonts <span className="muted">{rows.length}</span>
        </button>
        <div className="side-title">Collections</div>
        {collections.map((c) => (
          <div key={c.id} className={`side-item ${collection === c.id ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => setCollection(c.id)}>
            <span className="side-name">{c.name}</span>
            <span className="muted">{c.families.length}</span>
          </div>
        ))}
        {creating ? (
          <TextInput
            label="Collection name"
            isLabelHidden
            size="sm"
            hasAutoFocus
            value={newName}
            onChange={setNewName}
            placeholder="e.g. Brand fonts"
            onEnter={() => {
              if (newName.trim()) {
                const c = { id: String(Date.now()), name: newName.trim(), families: [...checked] };
                saveCollections([...collections, c]);
                setCollection(c.id);
              }
              setNewName('');
              setCreating(false);
            }}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
          />
        ) : (
          <Button size="sm" variant="ghost" label="New collection" icon={<Plus size={14} />} onClick={() => setCreating(true)} />
        )}
        {coll && (
          <div className="side-coll-actions">
            <Button size="sm" variant="ghost" label="Export as zip" icon={<Download size={14} />} onClick={() => exportFamilies(rows.filter((r) => coll.families.includes(r.family)), coll.name)} />
            <Button
              size="sm"
              variant="ghost"
              label="Delete collection"
              onClick={() => {
                saveCollections(collections.filter((c) => c.id !== coll.id));
                setCollection(null);
              }}
            />
          </div>
        )}
      </aside>

      <section className="m-content">
        {installedLoading && !installed.length && (
          <div className="center-pad">
            <Spinner size="lg" label="Reading your fonts" />
          </div>
        )}
        {!installedLoading && visible.length === 0 && <EmptyState title={coll ? 'This collection is empty' : 'Nothing here'} description={coll ? 'Select fonts in All fonts and use “Add to collection”.' : 'Try another filter.'} />}

        <div className="m-grid">
          {visible.map((r) => (
            <FamilyTile key={r.family} row={r} text={previewText} checked={checked.has(r.family)} selecting={checked.size > 0} onCheck={(v) => toggle(r.family, v)} onOpen={() => setDetails(r.family)} />
          ))}
        </div>
      </section>
    </div>

      <FamilyDetails row={rows.find((r) => r.family === details) ?? null} onClose={() => setDetails(null)} />

      <Dialog isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} width={440}>
        <DialogHeader title={`Uninstall ${plural(confirm?.length ?? 0, 'family', 'families')}?`} onOpenChange={() => setConfirm(null)} />
        <div className="confirm-body">
          <p className="muted">
            {confirm?.slice(0, 6).join(', ')}
            {(confirm?.length ?? 0) > 6 ? '…' : ''}
          </p>
          <p className="small muted">You can undo this right after. Apps that are open may keep using the fonts until restarted.</p>
          <div className="review-footer">
            <div className="grow" />
            <Button label="Cancel" variant="ghost" onClick={() => setConfirm(null)} />
            <Button
              label="Uninstall"
              variant="destructive"
              clickAction={async () => {
                const fams = rows.filter((r) => confirm?.includes(r.family));
                await uninstallPaths(fams.flatMap((r) => r.files.map((f) => f.path)), plural(fams.length, 'family', 'families'));
                setChecked(new Set());
                setConfirm(null);
              }}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
