import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '@astryxdesign/core/Toast';
import { Button } from '@astryxdesign/core/Button';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { api, plural } from './api';
import {
  DEFAULT_SETTINGS,
  type Catalog,
  type CatalogFamily,
  type Collection,
  type InstalledFont,
  type InstallResult,
  type Progress,
  type RecentFamily,
  type Settings,
  type ZipInfo,
  type FontCandidate,
} from './types';

export type Page = 'home' | 'discover' | 'manage' | 'settings';

export interface AppInstall {
  family: string;
  lastModified: string;
  files: string[];
  date: string;
}

interface Ctx {
  page: Page;
  go: (p: Page) => void;
  familyId: string | null;
  openFamily: (id: string | null) => void;
  manageFocus: string | null;
  openManage: (family: string | null) => void;

  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;

  installed: InstalledFont[];
  installedLoading: boolean;
  refreshInstalled: () => Promise<InstalledFont[]>;
  installedFamilies: Set<string>;

  catalog: Catalog | null;
  catalogError: string | null;
  catalogLoading: boolean;
  loadCatalog: (force?: boolean) => Promise<void>;
  catalogById: Map<string, CatalogFamily>;

  recents: RecentFamily[];
  appInstalls: Record<string, AppInstall>;
  collections: Collection[];
  saveCollections: (c: Collection[]) => void;

  jobs: Progress[];
  installFamily: (f: CatalogFamily, styles?: string[] | null) => Promise<void>;
  installFiles: (files: string[], label: string) => Promise<InstallResult[]>;
  uninstallPaths: (paths: string[], label: string) => Promise<void>;

  compare: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;

  zips: ZipInfo[];
  refreshZips: () => Promise<void>;
  /** Font files, font zips and font folders in watched folders that aren't fully installed. */
  inbox: FontCandidate[];
  dismiss: (c: FontCandidate) => void;

  previewText: string;
  setPreviewText: (t: string) => void;
  searchOpen: boolean;
  setSearchOpen: (o: boolean) => void;

  /** A newer Fontier release on GitHub, once a check has found one. */
  update: Update | null;
  updateState: UpdateState;
  updateError: string;
  /** Download progress, 0 to 1. */
  updateProgress: number;
  checkForUpdate: (quiet?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
}

export type UpdateState = 'idle' | 'checking' | 'none' | 'downloading' | 'error';

const AppContext = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppContext missing');
  return c;
};

export const DEFAULT_PREVIEW = 'The quick brown fox jumps over the lazy dog';

function groupInstalledFamilies(results: InstallResult[]) {
  const map = new Map<string, InstallResult[]>();
  for (const r of results.filter((r) => r.status === 'installed')) {
    const list = map.get(r.family) ?? [];
    list.push(r);
    map.set(r.family, list);
  }
  return map;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [page, setPage] = useState<Page>('home');
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [manageFocus, setManageFocus] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [autoInstallSince, setAutoInstallSince] = useState(0);
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState<InstalledFont[]>([]);
  const [installedLoading, setInstalledLoading] = useState(true);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [recents, setRecents] = useState<RecentFamily[]>([]);
  const [appInstalls, setAppInstalls] = useState<Record<string, AppInstall>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [jobs, setJobs] = useState<Progress[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [zips, setZips] = useState<ZipInfo[]>([]);
  const [inboxAll, setInboxAll] = useState<FontCandidate[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [previewText, setPreviewText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ---------------------------------------------------------------- load persisted state
  useEffect(() => {
    (async () => {
      const [s, r, c, ai, dl, dis, installSince] = await Promise.all([
        api.storeGet<Settings>('settings'),
        api.storeGet<RecentFamily[]>('recents'),
        api.storeGet<Collection[]>('collections'),
        api.storeGet<Record<string, AppInstall>>('app-installs'),
        api.downloadsDir(),
        api.storeGet<string[]>('dismissed'),
        api.storeGet<number>('auto-install-since'),
      ]);
      setAutoInstallSince(installSince ?? 0);
      setDismissed(dis ?? []);
      const merged: Settings = { ...DEFAULT_SETTINGS, ...(s ?? {}), sources: { ...DEFAULT_SETTINGS.sources, ...(s?.sources ?? {}) } };
      if (!merged.watchFolders.length && dl) merged.watchFolders = [dl];
      setSettings(merged);
      setPreviewText(merged.previewText);
      setRecents(r ?? []);
      setCollections(c ?? []);
      setAppInstalls(ai ?? {});
      setReady(true);
    })();
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      api.storeSet('settings', next);
      return next;
    });
    if (patch.autoInstall) {
      const now = Math.floor(Date.now() / 1000);
      setAutoInstallSince(now);
      api.storeSet('auto-install-since', now);
    }
  }, []);

  // ---------------------------------------------------------------- installed fonts
  const refreshInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const list = await api.listInstalled();
      setInstalled(list);
      return list;
    } finally {
      setInstalledLoading(false);
    }
  }, []);
  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  const installedFamilies = useMemo(() => {
    const s = new Set<string>();
    for (const f of installed) if (f.enabled) for (const face of f.faces) s.add(face.family.toLowerCase());
    return s;
  }, [installed]);

  // ---------------------------------------------------------------- catalog
  const loadCatalog = useCallback(async (force = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setCatalog(await api.catalog(force));
    } catch (e) {
      setCatalogError(String(e));
    } finally {
      setCatalogLoading(false);
    }
  }, []);
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);
  const catalogById = useMemo(() => new Map((catalog?.families ?? []).map((f) => [f.id, f])), [catalog]);

  // ---------------------------------------------------------------- zips in watched folders
  // Only font-like things are tracked: zips holding fonts, loose font files, folders of fonts.
  const refreshZips = useCallback(async () => {
    const folders = settingsRef.current.watchFolders;
    if (!folders.length) {
      setZips([]);
      setInboxAll([]);
      return;
    }
    try {
      setInboxAll(await api.fontInbox(folders));
    } catch {
      /* folder missing: ignore */
    }
  }, []);
  // Re-check after installs so items you just installed drop off the list.
  useEffect(() => {
    if (ready) refreshZips();
  }, [installed, ready, refreshZips]);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const inbox = useMemo(
    () => inboxAll.filter((c) => c.fontsInstalled < c.fonts && !dismissedSet.has(`${c.path}|${c.modified}`)),
    [inboxAll, dismissedSet],
  );
  const dismiss = useCallback((c: FontCandidate) => {
    setDismissed((prev) => {
      const next = [...prev, `${c.path}|${c.modified}`].slice(-500);
      api.storeSet('dismissed', next);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    refreshZips();
    // Backup check; the backend's folder watcher normally reports changes instantly.
    const t = setInterval(() => document.visibilityState === 'visible' && refreshZips(), 30000);
    return () => clearInterval(t);
  }, [ready, settings.watchFolders, refreshZips]);

  // ---------------------------------------------------------------- install jobs
  useEffect(() => {
    const un = listen<Progress>('install-progress', (e) => {
      setJobs((prev) => {
        const i = prev.findIndex((j) => j.jobId === e.payload.jobId);
        if (i < 0) return [...prev, e.payload];
        const next = [...prev];
        next[i] = e.payload;
        return next;
      });
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const remindRestart = useCallback(async () => {
    const apps = await api.runningApps().catch(() => []);
    if (apps.length) {
      const list = apps.length > 1 ? `${apps.slice(0, -1).join(', ')} and ${apps[apps.length - 1]}` : apps[0];
      toast({ body: `Restart ${list} to see the new fonts.`, isAutoHide: false, uniqueID: 'restart' });
    }
  }, [toast]);

  const pushRecents = useCallback((entries: RecentFamily[]) => {
    if (!entries.length) return;
    setRecents((prev) => {
      const names = new Set(entries.map((e) => e.family.toLowerCase()));
      const next = [...entries, ...prev.filter((p) => !names.has(p.family.toLowerCase()))].slice(0, 20);
      api.storeSet('recents', next);
      return next;
    });
  }, []);

  const undoInstall = useCallback(
    async (paths: string[]) => {
      await api.uninstall(paths);
      setRecents((prev) => {
        const set = new Set(paths);
        const next = prev.filter((r) => !r.files.some((f) => set.has(f)));
        api.storeSet('recents', next);
        return next;
      });
      await refreshInstalled();
      toast({ body: 'Install undone' });
    },
    [refreshInstalled, toast],
  );

  const reportInstall = useCallback(
    (results: InstallResult[], label: string) => {
      const ok = results.filter((r) => r.status === 'installed');
      const skipped = results.filter((r) => r.status === 'skipped').length;
      const failed = results.filter((r) => r.status === 'failed');
      if (failed.length) {
        toast({ type: 'error', body: `${plural(failed.length, 'font')} could not be installed: ${failed[0].message}` });
      }
      if (ok.length) {
        const paths = ok.map((r) => r.installedPath).filter(Boolean);
        toast({
          body: `Installed ${plural(ok.length, 'font')} from ${label}${skipped ? ` · ${skipped} already installed` : ''}`,
          autoHideDuration: 8000,
          endContent: paths.length ? <Button size="sm" variant="ghost" label="Undo" onClick={() => undoInstall(paths)} /> : undefined,
        });
        remindRestart();
      } else if (skipped && !failed.length) {
        toast({ body: `Already installed: ${label}` });
      }
    },
    [toast, undoInstall, remindRestart],
  );

  const installFiles = useCallback(
    async (files: string[], label: string) => {
      const results = await api.installFiles(files, settingsRef.current.scope);
      const now = new Date().toISOString();
      pushRecents(
        [...groupInstalledFamilies(results)].map(([family, rs]) => ({
          family,
          source: 'drop' as const,
          styles: rs.length,
          date: now,
          files: rs.map((r) => r.installedPath),
        })),
      );
      reportInstall(results, label);
      await refreshInstalled();
      return results;
    },
    [pushRecents, reportInstall, refreshInstalled],
  );

  const installFamily = useCallback(
    async (f: CatalogFamily, styles: string[] | null = null) => {
      const jobId = `${f.id}-${Date.now()}`;
      setJobs((prev) => [...prev, { jobId, family: f.family, stage: 'queued', done: 0, total: 0, message: '' }]);
      try {
        const results = await api.installFamily(f.id, styles, settingsRef.current.preferStatic, settingsRef.current.scope, jobId);
        const ok = results.filter((r) => r.status === 'installed');
        const now = new Date().toISOString();
        if (ok.length) {
          pushRecents([{ family: f.family, source: f.source, catalogId: f.id, styles: ok.length, date: now, files: ok.map((r) => r.installedPath), lastModified: f.lastModified }]);
        }
        if (ok.length || results.some((r) => r.status === 'skipped')) {
          setAppInstalls((prev) => {
            const next = { ...prev, [f.id]: { family: f.family, lastModified: f.lastModified, files: [...new Set([...(prev[f.id]?.files ?? []), ...ok.map((r) => r.installedPath)])], date: now } };
            api.storeSet('app-installs', next);
            return next;
          });
        }
        reportInstall(results, f.family);
        await refreshInstalled();
      } catch (e) {
        setJobs((prev) => prev.map((j) => (j.jobId === jobId ? { ...j, stage: 'error', message: String(e) } : j)));
        toast({ type: 'error', body: `Couldn't install ${f.family}: ${String(e)}` });
      }
    },
    [pushRecents, reportInstall, refreshInstalled, toast],
  );

  const uninstallPaths = useCallback(
    async (paths: string[], label: string) => {
      const stored = await api.uninstall(paths);
      await refreshInstalled();
      toast({
        body: `Removed ${label}`,
        autoHideDuration: 8000,
        endContent: stored.length ? (
          <Button
            size="sm"
            variant="ghost"
            label="Undo"
            onClick={async () => {
              await api.restore(stored);
              await refreshInstalled();
            }}
          />
        ) : undefined,
      });
    },
    [refreshInstalled, toast],
  );

  // ---------------------------------------------------------------- smart install
  // The backend watches the folders and installs new fonts itself (works while hidden in the tray).
  // Here we just keep it configured and turn its reports into the usual toast + Recents entry.
  useEffect(() => {
    if (!ready) return;
    api.configureSmart({ enabled: settings.autoInstall, folders: settings.watchFolders, since: autoInstallSince, scope: settings.scope }).catch(() => {});
  }, [ready, settings.autoInstall, settings.watchFolders, settings.scope, autoInstallSince]);
  useEffect(() => {
    if (ready) api.setKeepInTray(settings.keepInTray).catch(() => {});
  }, [ready, settings.keepInTray]);
  useEffect(() => {
    const a = listen<{ label: string; results: InstallResult[] }>('smart-installed', async (e) => {
      const { label, results } = e.payload;
      const now = new Date().toISOString();
      pushRecents(
        [...groupInstalledFamilies(results)].map(([family, rs]) => ({ family, source: 'drop' as const, styles: rs.length, date: now, files: rs.map((r) => r.installedPath) })),
      );
      reportInstall(results, `${label} (smart install)`);
      await refreshInstalled();
    });
    // Something changed in a watched folder: refresh "Fonts waiting" straight away.
    const b = listen('inbox-changed', () => refreshZips());
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, [pushRecents, reportInstall, refreshInstalled, refreshZips]);

  // ---------------------------------------------------------------- updates
  // Releases come from GitHub (see plugins.updater in tauri.conf.json). Each one is signed, and the
  // updater refuses anything that doesn't match the public key built into the app.
  const [update, setUpdate] = useState<Update | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateError, setUpdateError] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const updateRef = useRef<Update | null>(null);

  const installUpdate = useCallback(async () => {
    const u = updateRef.current;
    if (!u) return;
    setUpdateState('downloading');
    setUpdateProgress(0);
    let total = 0;
    let got = 0;
    try {
      await u.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress' && total) setUpdateProgress((got += e.data.chunkLength) / total);
      });
      // On Windows the installer has already closed Fontier and will open the new version.
      await relaunch();
    } catch (e) {
      setUpdateState('error');
      setUpdateError(String(e));
      toast({ type: 'error', body: `Update failed: ${String(e)}` });
    }
  }, [toast]);

  const checkForUpdate = useCallback(
    async (quiet = false) => {
      setUpdateState('checking');
      try {
        const u = await check();
        updateRef.current = u;
        setUpdate(u);
        setUpdateState(u ? 'idle' : 'none');
        if (u) {
          toast({
            body: `Fontier ${u.version} is available`,
            isAutoHide: false,
            uniqueID: 'update',
            endContent: <Button size="sm" label="Update" onClick={() => installUpdate()} />,
          });
        }
      } catch (e) {
        // A quiet check (offline, GitHub down) just tries again later.
        setUpdateState(quiet ? 'idle' : 'error');
        setUpdateError(String(e));
      }
    },
    [toast, installUpdate],
  );

  useEffect(() => {
    if (!ready) return;
    const first = setTimeout(() => checkForUpdate(true), 4000);
    // Fontier can sit in the tray for weeks: look again twice a day.
    const again = setInterval(() => checkForUpdate(true), 12 * 60 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [ready, checkForUpdate]);

  // ---------------------------------------------------------------- misc
  const saveCollections = useCallback((c: Collection[]) => {
    setCollections(c);
    api.storeSet('collections', c);
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompare((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-4)));
  }, []);

  const go = useCallback((p: Page) => {
    setPage(p);
    setFamilyId(null);
  }, []);
  const openFamily = useCallback((id: string | null) => {
    setFamilyId(id);
    if (id) setPage('discover');
  }, []);
  const openManage = useCallback((family: string | null) => {
    setManageFocus(family);
    setPage('manage');
    setFamilyId(null);
  }, []);

  const value: Ctx = {
    page,
    go,
    familyId,
    openFamily,
    manageFocus,
    openManage,
    settings,
    updateSettings,
    installed,
    installedLoading,
    refreshInstalled,
    installedFamilies,
    catalog,
    catalogError,
    catalogLoading,
    loadCatalog,
    catalogById,
    recents,
    appInstalls,
    collections,
    saveCollections,
    jobs,
    installFamily,
    installFiles,
    uninstallPaths,
    compare,
    toggleCompare,
    clearCompare: () => setCompare([]),
    zips,
    refreshZips,
    inbox,
    dismiss,
    previewText: previewText || settings.previewText || DEFAULT_PREVIEW,
    setPreviewText,
    searchOpen,
    setSearchOpen,
    update,
    updateState,
    updateError,
    updateProgress,
    checkForUpdate,
    installUpdate,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
