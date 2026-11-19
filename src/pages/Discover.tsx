import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { LayoutGrid, Rows3, Search, WifiOff, X } from 'lucide-react';
import { useApp } from '../lib/state';
import { FontCard } from '../components/FontCard';
import { PreviewBar } from '../components/PreviewBar';
import { FamilyView } from './FamilyView';
import { CompareView } from './Compare';
import { CATEGORY_LABEL, type CatalogFamily, type Category, type Source } from '../lib/types';

const LANGUAGES = [
  ['any', 'Any language'],
  ['latin', 'Latin'],
  ['latin-ext', 'Latin Extended'],
  ['devanagari', 'Devanagari (Hindi, Marathi)'],
  ['bengali', 'Bengali'],
  ['gujarati', 'Gujarati'],
  ['gurmukhi', 'Gurmukhi (Punjabi)'],
  ['kannada', 'Kannada'],
  ['malayalam', 'Malayalam'],
  ['tamil', 'Tamil'],
  ['telugu', 'Telugu'],
  ['oriya', 'Odia'],
  ['arabic', 'Arabic'],
  ['hebrew', 'Hebrew'],
  ['cyrillic', 'Cyrillic'],
  ['greek', 'Greek'],
  ['vietnamese', 'Vietnamese'],
  ['thai', 'Thai'],
  ['japanese', 'Japanese'],
  ['korean', 'Korean'],
  ['chinese-simplified', 'Chinese (Simplified)'],
] as const;

type Sort = 'popular' | 'newest' | 'name' | 'styles';

export function DiscoverPage() {
  const { catalog, catalogLoading, catalogError, loadCatalog, familyId, compare, clearCompare, settings, catalogById, installedFamilies, previewText } = useApp();
  const [query, setQuery] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [lang, setLang] = useState('any');
  const [minStyles, setMinStyles] = useState('0');
  const [variableOnly, setVariableOnly] = useState(false);
  const [license, setLicense] = useState('any');
  const [sort, setSort] = useState<Sort>('popular');
  const [size, setSize] = useState(24);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [showCompare, setShowCompare] = useState(false);

  const enabledSources = (Object.keys(settings.sources) as Source[]).filter((s) => settings.sources[s]);

  // Fonts you already have never show here; they live in Manage.
  const notInstalled = useMemo(
    () => (catalog?.families ?? []).filter((f) => enabledSources.includes(f.source) && !installedFamilies.has(f.family.toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, installedFamilies, settings.sources],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = parseInt(minStyles, 10);
    const out = notInstalled.filter((f) => {
      if (cats.length && !cats.includes(f.category)) return false;
      if (lang !== 'any' && !f.subsets.includes(lang)) return false;
      if (f.styleCount < min) return false;
      if (variableOnly && !f.variable) return false;
      if (license !== 'any') {
        const l = f.license.toLowerCase();
        if (license === 'ofl' && !l.startsWith('ofl')) return false;
        if (license === 'apache' && !l.startsWith('apache')) return false;
        if (license === 'other' && (l.startsWith('ofl') || l.startsWith('apache'))) return false;
      }
      if (q && !f.family.toLowerCase().includes(q) && !f.designer.toLowerCase().includes(q)) return false;
      return true;
    });
    const cmp: Record<Sort, (a: CatalogFamily, b: CatalogFamily) => number> = {
      popular: (a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family),
      newest: (a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '') || a.family.localeCompare(b.family),
      name: (a, b) => a.family.localeCompare(b.family),
      styles: (a, b) => b.styleCount - a.styleCount,
    };
    return out.sort(cmp[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notInstalled, query, cats, lang, minStyles, variableOnly, license, sort]);

  // ---------------------------------------------------------------- virtual grid
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [familyId, showCompare]);
  // Relaxed grid: cards at least 360px wide with 40px gutters. Row = card + 40px gap;
  // the card fits head + two sample lines (line-height 1.38) + footer with room to breathe.
  const cols = layout === 'list' ? 1 : Math.max(1, Math.floor((width + 40) / 400));
  const rowHeight = layout === 'list' ? Math.round(196 + size * 1.38) : Math.round(204 + size * 2.76);
  const rows = Math.ceil(list.length / cols);
  const virt = useVirtualizer({
    count: rows,
    getScrollElement: () => document.querySelector('.page'),
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin: gridRef.current?.offsetTop ?? 0,
  });
  useEffect(() => virt.measure(), [rowHeight, cols, virt]);

  if (familyId) return <FamilyView id={familyId} />;
  if (showCompare) return <CompareView onClose={() => setShowCompare(false)} />;

  return (
    <div className="discover">
      <div className="discover-toolbar">
      <div className="filters">
        <ToggleButtonGroup label="Category" type="multiple" value={cats} onChange={(v: string | string[] | null) => setCats((v as string[]) ?? [])} size="sm">
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <ToggleButton key={c} value={c} label={CATEGORY_LABEL[c]} />
          ))}
        </ToggleButtonGroup>
        <div className="grow" />
        <TextInput label="Search the library" isLabelHidden size="sm" value={query} onChange={setQuery} placeholder="Search families or designers" hasClear startIcon={Search} width={250} />
        <Selector
          label="Sort"
          isLabelHidden
          size="sm"
          value={sort}
          onChange={(v) => setSort(v as Sort)}
          width={150}
          options={[
            { value: 'popular', label: 'Most popular' },
            { value: 'newest', label: 'Newest' },
            { value: 'name', label: 'Name A–Z' },
            { value: 'styles', label: 'Most styles' },
          ]}
        />
      </div>
      <div className="filters">
        <Selector label="Language" isLabelHidden size="sm" hasSearch value={lang} onChange={(v) => setLang(v ?? 'any')} width={210} options={LANGUAGES.map(([value, label]) => ({ value, label }))} />
        <Selector
          label="Styles"
          isLabelHidden
          size="sm"
          value={minStyles}
          onChange={(v) => setMinStyles(v ?? '0')}
          width={170}
          options={[
            { value: '0', label: 'Number of styles' },
            { value: '4', label: '4+ styles' },
            { value: '8', label: '8+ styles' },
            { value: '12', label: '12+ styles' },
          ]}
        />
        <Selector
          label="License"
          isLabelHidden
          size="sm"
          value={license}
          onChange={(v) => setLicense(v ?? 'any')}
          width={160}
          options={[
            { value: 'any', label: 'Any license' },
            { value: 'ofl', label: 'Open Font License' },
            { value: 'apache', label: 'Apache 2.0' },
            { value: 'other', label: 'Other free licenses' },
          ]}
        />
        <Switch label="Variable only" size="sm" value={variableOnly} onChange={setVariableOnly} />
      </div>

        <PreviewBar
          size={size}
          onSize={setSize}
          extra={
            <SegmentedControl label="Layout" value={layout} onChange={(v) => setLayout(v as 'grid' | 'list')} size="sm">
              <SegmentedControlItem value="grid" label="Grid" isLabelHidden icon={<LayoutGrid size={15} />} />
              <SegmentedControlItem value="list" label="List" isLabelHidden icon={<Rows3 size={15} />} />
            </SegmentedControl>
          }
        />
      </div>

      {catalogLoading && !catalog && (
        <div className="center-pad">
          <Spinner size="lg" label="Loading the font library" />
        </div>
      )}
      {catalogError && !catalog && (
        <EmptyState icon={<WifiOff size={30} />} title="Couldn't reach the font libraries" description="Check your internet connection. Once loaded, the library is kept for offline browsing." actions={<Button label="Try again" onClick={() => loadCatalog(true)} />} />
      )}
      {catalog && list.length === 0 && <EmptyState title="No families match" description="Try removing a filter." />}

      <div ref={gridRef} className="vgrid" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="vrow"
            style={{ transform: `translateY(${row.start - virt.options.scrollMargin}px)`, height: rowHeight, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {list.slice(row.index * cols, row.index * cols + cols).map((f) => (
              <FontCard key={f.id} f={f} text={previewText} size={size} layout={layout} />
            ))}
          </div>
        ))}
      </div>

      {compare.length > 0 && (
        <div className="compare-tray">
          <span className="small">Compare</span>
          {compare.map((id) => (
            <span key={id} className="chip">
              {catalogById.get(id)?.family}
            </span>
          ))}
          <div className="grow" />
          <Button size="sm" variant="ghost" label="Clear" icon={<X size={14} />} onClick={clearCompare} />
          <Button size="sm" variant="primary" label={`Compare ${compare.length}`} isDisabled={compare.length < 2} onClick={() => setShowCompare(true)} />
        </div>
      )}
    </div>
  );
}
