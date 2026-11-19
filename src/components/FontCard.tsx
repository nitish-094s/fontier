import { memo } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Columns2, Check } from 'lucide-react';
import { useApp } from '../lib/state';
import { catalogSource, sampleFor, useFont, useInView } from '../lib/fontLoader';
import type { CatalogFamily } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';

export function useFamilyStatus(f: CatalogFamily) {
  const { jobs, installedFamilies } = useApp();
  const job = [...jobs].reverse().find((j) => j.family === f.family);
  const busy = !!job && job.stage !== 'done' && job.stage !== 'error';
  const installed = installedFamilies.has(f.family.toLowerCase());
  return { busy, installed, job };
}

export function InstallFamilyButton({ f, size = 'sm', styles = null, label }: { f: CatalogFamily; size?: 'sm' | 'md' | 'lg'; styles?: string[] | null; label?: string }) {
  const { installFamily } = useApp();
  const { busy, installed, job } = useFamilyStatus(f);
  if (installed && !styles && !busy) return <Button size={size} label="Installed" icon={<Check size={15} />} isDisabled />;
  const text = busy ? (job?.stage === 'downloading' && job.total ? `${job.done}/${job.total}` : 'Installing') : label ?? 'Install family';
  return <Button size={size} variant="primary" label={text} isLoading={busy} onClick={() => installFamily(f, styles)} />;
}

export const FontCard = memo(function FontCard({ f, text, size, layout }: { f: CatalogFamily; text: string; size: number; layout: 'grid' | 'list' }) {
  const { openFamily, compare, toggleCompare } = useApp();
  const { ref, seen } = useInView<HTMLDivElement>('600px');
  const { family, failed } = useFont(catalogSource(f), seen);
  const inCompare = compare.includes(f.id);
  return (
    <div className={`font-card ${layout}`} ref={ref}>
      <button className="font-card-hit" aria-label={`Open ${f.family}`} onClick={() => openFamily(f.id)} />
      <div className="font-card-head">
        <div className="font-card-name">{f.family}</div>
        <div className="font-card-meta">
          {f.designer ? `${f.designer.split(',')[0]} · ` : ''}
          {f.styleCount} {f.styleCount === 1 ? 'style' : 'styles'}
          {f.variable ? ' · Variable' : ''}
        </div>
      </div>
      <div
        className={`font-card-sample ${family ? 'is-loaded' : ''}`}
        style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined, fontSize: size }}
      >
        {failed ? <span className="muted small">Preview unavailable</span> : sampleFor(f, text)}
      </div>
      <div className="font-card-foot">
        <span className="tag">{CATEGORY_LABEL[f.category]}</span>
        <div className="grow" />
        <IconButton
          size="sm"
          variant={inCompare ? 'secondary' : 'ghost'}
          label={inCompare ? 'Remove from compare' : 'Compare'}
          tooltip={inCompare ? 'Remove from compare' : 'Add to compare'}
          icon={<Columns2 size={15} />}
          onClick={() => toggleCompare(f.id)}
        />
        <InstallFamilyButton f={f} />
      </div>
    </div>
  );
});
