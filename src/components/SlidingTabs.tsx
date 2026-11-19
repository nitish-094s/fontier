import { useLayoutEffect, useRef, useState } from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

/**
 * Tabs inside one pill. The highlight is its own layer that springs to the chosen tab,
 * so the main nav (Home / Discover / Manage) and page filters behave the same way.
 */
export function SlidingTabs({
  items,
  value,
  onChange,
  label,
  size = 'md',
}: {
  items: TabItem[];
  value: string | null;
  onChange: (id: string) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Left and right edges are positioned separately (inset from each side of the pill).
  const [ind, setInd] = useState<{ left: number; right: number; dir: 'right' | 'left' | 'none' } | null>(null);
  const prevLeft = useRef<number | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = value ? refs.current[value] : null;
      const box = wrap.current;
      if (!el || !box) return setInd(null);
      // Sub-pixel measurements: offsetLeft/offsetWidth round to whole pixels and left a 1px overhang.
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const left = r.left - b.left - box.clientLeft;
      const right = b.right - r.right - box.clientLeft;
      const dir = prevLeft.current === null || prevLeft.current === left ? 'none' : left > prevLeft.current ? 'right' : 'left';
      prevLeft.current = left;
      setInd({ left, right, dir });
    };
    measure();
    // Counts or fonts loading can change tab widths; keep the highlight glued on.
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, items.length]);

  return (
    <div className={`tabs tabs-${size}`} role="tablist" aria-label={label} ref={wrap}>
      {/* The leading edge glides in and stops exactly at the tab; the trailing edge follows with a
          spring. Any overshoot briefly narrows the highlight inside the pill instead of poking out. */}
      <span
        className={`tabs-indicator moving-${ind?.dir ?? 'none'}`}
        aria-hidden="true"
        style={ind ? { left: ind.left, right: ind.right, opacity: 1 } : { opacity: 0 }}
      />
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
