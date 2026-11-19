import { useState } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Heading } from '@astryxdesign/core/Heading';
import { ArrowLeft, X } from 'lucide-react';
import { useApp } from '../lib/state';
import { catalogSource, sampleFor, useFont } from '../lib/fontLoader';
import { PreviewBar } from '../components/PreviewBar';
import { InstallFamilyButton } from '../components/FontCard';
import { CATEGORY_LABEL, type CatalogFamily } from '../lib/types';

function Column({ f, size }: { f: CatalogFamily; size: number }) {
  const { previewText, toggleCompare, openFamily } = useApp();
  const regular = useFont(catalogSource(f)).family;
  const bold = useFont(catalogSource(f, f.styles.includes('700') ? 700 : undefined)).family;
  const text = sampleFor(f, previewText);
  const ff = (fam: string | null) => (fam ? `${fam}, var(--font-family-body)` : undefined);
  return (
    <div className="compare-col">
      <div className="compare-head">
        <button className="link compare-name" onClick={() => openFamily(f.id)}>
          {f.family}
        </button>
        <IconButton size="sm" variant="ghost" label="Remove" tooltip="Remove" icon={<X size={14} />} onClick={() => toggleCompare(f.id)} />
      </div>
      <div className="muted small">
        {CATEGORY_LABEL[f.category]} · {f.styleCount} styles
      </div>
      <div className="compare-big" style={{ fontFamily: ff(bold), fontSize: size * 1.4 }}>
        Aa Gg 123
      </div>
      <div className="compare-text" style={{ fontFamily: ff(regular), fontSize: size }}>
        {text}
      </div>
      <div className="compare-para" style={{ fontFamily: ff(regular) }}>
        {text} — set at reading size to judge texture, rhythm and how it holds up in long paragraphs.
      </div>
      <InstallFamilyButton f={f} />
    </div>
  );
}

export function CompareView({ onClose }: { onClose: () => void }) {
  const { compare, catalogById } = useApp();
  const [size, setSize] = useState(32);
  const fams = compare.map((id) => catalogById.get(id)).filter(Boolean) as CatalogFamily[];
  return (
    <div className="compare">
      <div className="family-top">
        <IconButton label="Back" tooltip="Back to Discover" variant="ghost" icon={<ArrowLeft size={18} />} onClick={onClose} />
        <Heading level={1} className="page-title">
          Compare
        </Heading>
      </div>
      <PreviewBar size={size} onSize={setSize} />
      <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, fams.length)}, minmax(0, 1fr))` }}>
        {fams.map((f) => (
          <Column key={f.id} f={f} size={size} />
        ))}
      </div>
    </div>
  );
}
