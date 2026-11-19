import { useMemo } from 'react';
import { CommandPalette } from '@astryxdesign/core/CommandPalette';
import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead';
import { useApp } from '../lib/state';
import { SOURCE_LABEL } from '../lib/types';

type Item = SearchableItem<{ kind: 'installed' | 'library' | 'page'; hint: string }>;

export function SearchPalette() {
  const { searchOpen, setSearchOpen, installed, catalog, openFamily, openManage, go } = useApp();

  const source = useMemo<SearchSource<Item>>(() => {
    const families = new Map<string, number>();
    for (const f of installed) for (const face of f.faces) families.set(face.family, (families.get(face.family) ?? 0) + 1);
    const installedItems: Item[] = [...families.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fam, n]) => ({ id: `inst:${fam}`, label: fam, auxiliaryData: { kind: 'installed', hint: `On this PC · ${n} style${n > 1 ? 's' : ''}` } }));
    const libItems: Item[] = [...(catalog?.families ?? [])]
      .sort((a, b) => a.popularity - b.popularity)
      .map((f) => ({ id: `cat:${f.id}`, label: f.family, auxiliaryData: { kind: 'library', hint: `${SOURCE_LABEL[f.source]} · ${f.styleCount} styles` } }));
    const pages: Item[] = [
      { id: 'page:home', label: 'Home', auxiliaryData: { kind: 'page', hint: 'Go to' } },
      { id: 'page:discover', label: 'Discover', auxiliaryData: { kind: 'page', hint: 'Go to' } },
      { id: 'page:manage', label: 'Manage fonts', auxiliaryData: { kind: 'page', hint: 'Go to' } },
      { id: 'page:settings', label: 'Settings', auxiliaryData: { kind: 'page', hint: 'Go to' } },
    ];
    const match = (q: string, list: Item[], max: number) => {
      const starts: Item[] = [];
      const contains: Item[] = [];
      for (const it of list) {
        const l = it.label.toLowerCase();
        if (l.startsWith(q)) starts.push(it);
        else if (l.includes(q)) contains.push(it);
        if (starts.length >= max) break;
      }
      return [...starts, ...contains].slice(0, max);
    };
    return {
      bootstrap: () => [...pages, ...installedItems.slice(0, 5)],
      search: (query: string) => {
        const q = query.trim().toLowerCase();
        if (!q) return [...pages, ...installedItems.slice(0, 5)];
        return [...match(q, installedItems, 8), ...match(q, libItems, 20), ...match(q, pages, 4)];
      },
    };
  }, [installed, catalog]);

  return (
    <CommandPalette<Item>
      isOpen={searchOpen}
      onOpenChange={setSearchOpen}
      label="Search fonts"
      searchSource={source}
      emptyBootstrapText="Type a font name"
      onValueChange={(v) => {
        if (v.startsWith('inst:')) openManage(v.slice(5));
        else if (v.startsWith('cat:')) openFamily(v.slice(4));
        else if (v.startsWith('page:')) go(v.slice(5) as never);
      }}
      renderItem={(item) => (
        <div className="palette-row">
          <span>{item.label}</span>
          <span className={`palette-hint ${item.auxiliaryData?.kind}`}>{item.auxiliaryData?.hint}</span>
        </div>
      )}
    />
  );
}
