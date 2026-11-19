export interface FaceInfo {
  family: string;
  style: string;
  fullName: string;
  weight: number;
  italic: boolean;
  version: string;
  designer: string;
  license: string;
  index: number;
  psName: string;
}

export interface InstalledFont {
  path: string;
  regName: string;
  scope: 'system' | 'user';
  enabled: boolean;
  size: number;
  modified: number;
  /** When the file landed on this PC (unix seconds). */
  created: number;
  /** Shipped with Windows (owned by TrustedInstaller). */
  osFont: boolean;
  faces: FaceInfo[];
}

export interface InstallResult {
  source: string;
  family: string;
  style: string;
  status: 'installed' | 'skipped' | 'failed';
  message: string;
  installedPath: string;
}

export interface StoredFont {
  originalPath: string;
  storedPath: string;
  regName: string;
}

export interface FoundFont {
  origin: string;
  file: string;
  faces: FaceInfo[];
  installed: boolean;
}

export interface ScanResult {
  fonts: FoundFont[];
  license: string;
  skipped: string[];
}

export interface ZipInfo {
  path: string;
  name: string;
  target: string;
  files: number;
  present: number;
  fonts: number;
  fontsInstalled: number;
  state: 'extracted' | 'partial' | 'not-extracted' | 'empty' | 'unreadable';
  size: number;
  modified: number;
}

export interface ExtractResult {
  path: string;
  extracted: number;
  skipped: number;
  errors: string[];
  movedTo: string | null;
}

export interface Axis {
  tag: string;
  min: number;
  max: number;
  default: number;
}

export type Source = 'google' | 'fontsource' | 'fontsquirrel';
export type Category = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';

export interface CatalogFamily {
  id: string;
  family: string;
  source: Source;
  category: Category;
  designer: string;
  styles: string[];
  styleCount: number;
  variable: boolean;
  axes: Axis[];
  subsets: string[];
  license: string;
  popularity: number;
  dateAdded: string;
  lastModified: string;
  fsId: string | null;
  sqUrl: string | null;
}

export interface Catalog {
  fetchedAt: number;
  families: CatalogFamily[];
  errors: string[];
}

export interface Progress {
  jobId: string;
  family: string;
  stage: 'queued' | 'downloading' | 'installing' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
}

export interface RecentFamily {
  family: string;
  source: 'drop' | Source;
  catalogId?: string;
  styles: number;
  date: string;
  files: string[];
  lastModified?: string;
}

export interface Collection {
  id: string;
  name: string;
  families: string[];
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeMode;
  scope: 'user' | 'machine';
  watchFolders: string[];
  /** Smart install: install fonts that land in watched folders without asking. */
  autoInstall: boolean;
  /** Closing the window hides Fontier to the tray instead of quitting. */
  keepInTray: boolean;
  sources: Record<Source, boolean>;
  previewText: string;
  preferStatic: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  scope: 'user',
  watchFolders: [],
  autoInstall: false,
  keepInTray: true,
  sources: { google: true, fontsource: true, fontsquirrel: true },
  previewText: '',
  preferStatic: true,
};

export const CATEGORY_LABEL: Record<Category, string> = {
  sans: 'Sans serif',
  serif: 'Serif',
  display: 'Display',
  handwriting: 'Handwriting',
  mono: 'Monospace',
};

export const SOURCE_LABEL: Record<Source, string> = {
  google: 'Google Fonts',
  fontsource: 'Fontsource',
  fontsquirrel: 'Font Squirrel',
};

/** Something in a watched folder that is, or holds, fonts. */
export interface FontCandidate {
  path: string;
  name: string;
  kind: 'zip' | 'file' | 'folder';
  fonts: number;
  fontsInstalled: number;
  families: string[];
  modified: number;
  size: number;
}
