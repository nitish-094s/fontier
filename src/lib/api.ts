import { invoke } from '@tauri-apps/api/core';
import type {
  Catalog,
  ExtractResult,
  InstalledFont,
  InstallResult,
  ScanResult,
  StoredFont,
  ZipInfo,
  FaceInfo,
  FontCandidate,
} from './types';

export const api = {
  listInstalled: () => invoke<InstalledFont[]>('list_installed'),
  scanPaths: (paths: string[]) => invoke<ScanResult>('scan_paths', { paths }),
  installFiles: (files: string[], scope: string) => invoke<InstallResult[]>('install_files', { files, scope }),
  uninstall: (paths: string[]) => invoke<StoredFont[]>('uninstall', { paths }),
  restore: (items: StoredFont[]) => invoke<number>('restore', { items }),
  setEnabled: (paths: string[], enabled: boolean) => invoke<number>('set_enabled', { paths, enabled }),
  catalog: (force = false) => invoke<Catalog>('catalog', { force }),
  installFamily: (familyId: string, styles: string[] | null, preferStatic: boolean, scope: string, jobId: string) =>
    invoke<InstallResult[]>('install_family', { familyId, styles, preferStatic, scope, jobId }),
  squirrelPreview: (urlName: string) => invoke<{ file: string; faces: FaceInfo[] }[]>('squirrel_preview', { urlName }),
  readFontBytes: (path: string) => invoke<ArrayBuffer>('read_font_bytes', { path }),
  zipsStatus: (folders: string[]) => invoke<ZipInfo[]>('zips_status', { folders }),
  fontInbox: (folders: string[]) => invoke<FontCandidate[]>('font_inbox', { folders }),
  zipInfo: (paths: string[]) => invoke<ZipInfo[]>('zip_info', { paths }),
  extractZips: (paths: string[], moveAfter: boolean) => invoke<ExtractResult[]>('extract_zips', { paths, moveAfter }),
  runningApps: () => invoke<string[]>('running_apps'),
  storeGet: <T>(key: string) => invoke<T | null>('store_get', { key }),
  storeSet: (key: string, value: unknown) => invoke<void>('store_set', { key, value }),
  exportZip: (paths: string[], dest: string) => invoke<number>('export_zip', { paths, dest }),
  cacheInfo: () => invoke<{ bytes: number }>('cache_info'),
  clearCache: () => invoke<void>('clear_cache'),
  downloadsDir: () => invoke<string>('downloads_dir'),
  configureSmart: (config: { enabled: boolean; folders: string[]; since: number; scope: string }) => invoke<void>('configure_smart', { config }),
  setKeepInTray: (keep: boolean) => invoke<void>('set_keep_in_tray', { keep }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function plural(n: number, one: string, many = one + 's') {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
