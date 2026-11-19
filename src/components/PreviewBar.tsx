import { TextInput } from '@astryxdesign/core/TextInput';
import { Slider } from '@astryxdesign/core/Slider';
import { useApp, DEFAULT_PREVIEW } from '../lib/state';

const PRESETS = [
  { label: 'Pangram', text: DEFAULT_PREVIEW },
  { label: 'Numbers', text: '0123456789 ₹1,24,999 · 25 km/h' },
  { label: 'Paragraph', text: 'Good type is invisible. It carries the message, sets the tone and gets out of the way so the reader can move.' },
];

export function PreviewBar({ size, onSize, extra }: { size: number; onSize: (n: number) => void; extra?: React.ReactNode }) {
  const { previewText, setPreviewText } = useApp();
  return (
    <div className="preview-bar">
      <TextInput label="Preview text" isLabelHidden value={previewText} onChange={setPreviewText} placeholder="Type something to preview" hasClear width="100%" containerClassName="preview-input" />
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.label} className={`preset ${previewText === p.text ? 'on' : ''}`} onClick={() => setPreviewText(p.text)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="size-slider">
        <Slider label="Size" isLabelHidden min={12} max={120} value={size} onChange={(v: number) => onSize(v)} formatValue={(v) => `${v}px`} width={150} />
        <span className="muted small size-num">{size}px</span>
      </div>
      {extra}
    </div>
  );
}
