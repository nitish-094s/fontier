import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Download, Check, AlertCircle } from 'lucide-react';
import { useApp } from '../lib/state';

function Ring({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg className="queue-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} className="track" />
      <circle cx="18" cy="18" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
    </svg>
  );
}

export function QueueButton() {
  const { jobs } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = jobs.filter((j) => j.stage !== 'done' && j.stage !== 'error');
  const progress = active.length
    ? active.reduce((a, j) => a + (j.total ? j.done / j.total : 0) * (j.stage === 'installing' ? 1 : 0.9), 0) / active.length
    : 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="queue" ref={ref}>
      <IconButton
        label={active.length ? `${active.length} installing` : 'Installs'}
        tooltip={active.length ? `${active.length} installing` : 'Install queue'}
        variant="ghost"
        icon={<Download size={18} />}
        onClick={() => setOpen((o) => !o)}
      />
      {active.length > 0 && <Ring value={Math.max(0.06, progress)} />}
      {open && (
        <div className="queue-panel">
          <div className="queue-title">Installs</div>
          {jobs.length === 0 && <div className="muted small">Nothing installed yet this session.</div>}
          {[...jobs].reverse().slice(0, 8).map((j) => (
            <div key={j.jobId} className="queue-row">
              <div className="queue-row-head">
                <span className="queue-name">{j.family}</span>
                {j.stage === 'done' && <Check size={15} className="ok" />}
                {j.stage === 'error' && <AlertCircle size={15} className="bad" />}
                {j.stage !== 'done' && j.stage !== 'error' && <span className="muted small">{j.stage === 'queued' ? 'Starting…' : j.stage === 'downloading' ? `Downloading ${j.done}/${j.total || '…'}` : 'Installing…'}</span>}
              </div>
              {j.stage !== 'done' && j.stage !== 'error' && (
                <ProgressBar label={`${j.family} progress`} isLabelHidden value={j.total ? (j.done / j.total) * 100 : 0} isIndeterminate={!j.total} />
              )}
              {j.stage === 'error' && <div className="small bad">{j.message}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
