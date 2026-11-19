import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CatalogFamily } from './types';

/** Where a preview font comes from. Nothing is installed to preview. */
export type FontSource =
  | { kind: 'cdn'; fsId: string; subset: string; weight: number; italic: boolean }
  | { kind: 'cdnvar'; fsId: string; subset: string }
  | { kind: 'file'; path: string }
  | { kind: 'squirrel'; urlName: string; style?: string }
  | { kind: 'local'; family: string };

const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
const loaded = new Map<string, Promise<string | null>>();
let counter = 0;

// Downloads that go through the backend (Font Squirrel zips) run a few at a time.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function keyOf(s: FontSource): string {
  return JSON.stringify(s);
}

async function addFace(source: string | ArrayBuffer, descriptors?: FontFaceDescriptors): Promise<string> {
  const family = `kf-${++counter}`;
  const face = new FontFace(family, source, descriptors);
  await face.load();
  document.fonts.add(face);
  return family;
}

async function load(s: FontSource): Promise<string | null> {
  switch (s.kind) {
    case 'local':
      return `"${s.family}"`;
    case 'cdn': {
      const file = `${s.subset}-${s.weight}-${s.italic ? 'italic' : 'normal'}.woff2`;
      return addFace(`url(${CDN}/${s.fsId}@latest/${file})`);
    }
    case 'cdnvar':
      return addFace(`url(${CDN}/${s.fsId}:vf@latest/${s.subset}-wght-normal.woff2)`, { weight: '1 1000' });
    case 'file': {
      const bytes = await api.readFontBytes(s.path);
      return addFace(bytes);
    }
    case 'squirrel': {
      const files = await slot(() => api.squirrelPreview(s.urlName));
      const want = (s.style ?? 'regular').toLowerCase();
      const pick =
        files.find((f) => f.faces[0]?.style.toLowerCase() === want) ??
        files.find((f) => /regular|book|normal|roman/i.test(f.faces[0]?.style ?? '')) ??
        files[0];
      if (!pick) return null;
      return addFace(await api.readFontBytes(pick.file));
    }
  }
}

export function loadFont(s: FontSource): Promise<string | null> {
  const k = keyOf(s);
  let p = loaded.get(k);
  if (!p) {
    p = load(s).catch(() => {
      loaded.delete(k); // allow a retry later
      return null;
    });
    loaded.set(k, p);
  }
  return p;
}

export function useFont(source: FontSource | null, enabled = true) {
  const [family, setFamily] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const k = source ? keyOf(source) : '';
  useEffect(() => {
    if (!source || !enabled) return;
    let alive = true;
    setFailed(false);
    loadFont(source).then((f) => {
      if (!alive) return;
      if (f) setFamily(f);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, enabled]);
  return { family, failed };
}

/** True once the element has scrolled near the viewport (stays true). */
export function useInView<T extends Element>(margin = '300px') {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return { ref, seen };
}

// ------------------------------------------------------------------ catalog helpers

export function pickSubset(f: CatalogFamily): string {
  if (f.subsets.includes('latin')) return 'latin';
  return f.subsets[0] ?? 'latin';
}

export function defaultWeight(f: CatalogFamily): number {
  if (f.styles.includes('400')) return 400;
  const w = f.styles.filter((s) => !s.endsWith('i')).map((s) => parseInt(s, 10));
  return w.length ? w.reduce((a, b) => (Math.abs(b - 400) < Math.abs(a - 400) ? b : a)) : 400;
}

export function catalogSource(f: CatalogFamily, weight?: number, italic = false): FontSource | null {
  if (f.source === 'fontsquirrel' && f.sqUrl) return { kind: 'squirrel', urlName: f.sqUrl };
  if (f.fsId) return { kind: 'cdn', fsId: f.fsId, subset: pickSubset(f), weight: weight ?? defaultWeight(f), italic };
  return null;
}

/** Native-script sample for families that don't cover Latin. */
const SCRIPT_SAMPLES: Record<string, string> = {
  devanagari: 'नमस्ते, सुंदर अक्षर',
  bengali: 'সুন্দর অক্ষর',
  gujarati: 'સુંદર અક્ષરો',
  gurmukhi: 'ਸੁੰਦਰ ਅੱਖਰ',
  kannada: 'ಸುಂದರ ಅಕ್ಷರಗಳು',
  malayalam: 'മനോഹരമായ അക്ഷരങ്ങൾ',
  tamil: 'அழகான எழுத்துக்கள்',
  telugu: 'అందమైన అక్షరాలు',
  oriya: 'ସୁନ୍ଦର ଅକ୍ଷର',
  arabic: 'خط جميل',
  hebrew: 'אותיות יפות',
  thai: 'ตัวอักษรที่สวยงาม',
  japanese: '美しい文字',
  korean: '아름다운 글자',
  'chinese-simplified': '美丽的文字',
  'chinese-traditional': '美麗的文字',
  cyrillic: 'Красивые буквы',
  greek: 'Όμορφα γράμματα',
};

export function sampleFor(f: CatalogFamily, text: string): string {
  if (f.subsets.includes('latin') || f.source === 'fontsquirrel') return text;
  return SCRIPT_SAMPLES[pickSubset(f)] ?? text;
}

export const STYLE_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

export function styleLabel(key: string): string {
  const italic = key.endsWith('i');
  const w = parseInt(key, 10);
  const name = STYLE_NAMES[w] ?? String(w);
  if (!italic) return name;
  return name === 'Regular' ? 'Italic' : `${name} Italic`;
}
