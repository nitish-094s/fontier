import { useEffect, useRef, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport } from '@astryxdesign/core/Toast';
import { kernTheme } from './theme';
import { AppProvider, useApp } from './lib/state';
import { TopBar } from './components/TopBar';
import { SearchPalette } from './components/SearchPalette';
import { DropController } from './components/Drop';
import { HomePage } from './pages/Home';
import { DiscoverPage } from './pages/Discover';
import { ManagePage } from './pages/Manage';
import { SettingsPage } from './pages/Settings';

function useResolvedMode(mode: 'system' | 'light' | 'dark') {
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSysDark(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;
}

const ORDER = ['home', 'discover', 'manage', 'settings'];

/** Slides the new page in from the side it sits on in the menu (Home → Discover slides left). */
function usePageTransition(key: string, page: string) {
  const prev = useRef<{ key: string; page: string; dir: string }>({ key, page, dir: 'none' });
  if (prev.current.key !== key) {
    const a = ORDER.indexOf(prev.current.page);
    const b = ORDER.indexOf(page);
    // Same page (opening/closing a family): forward into a family slides from the right.
    const dir = b === a ? (key.includes(':') ? 'from-right' : 'from-left') : b > a ? 'from-right' : 'from-left';
    prev.current = { key, page, dir };
  }
  useEffect(() => {
    document.querySelector('.page')?.scrollTo({ top: 0 });
  }, [key]);
  return prev.current.dir;
}

function Shell() {
  const { page, setSearchOpen, familyId } = useApp();
  const viewKey = familyId ? `${page}:${familyId}` : page;
  const dir = usePageTransition(viewKey, page);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen]);
  return (
    <div className="app">
      <div className="glow" aria-hidden="true">
        <span className="g1" />
        <span className="g2" />
        <span className="g3" />
      </div>
      <TopBar />
      <main className="page">
        <div key={viewKey} className={`page-view ${dir}`}>
          {page === 'home' && <HomePage />}
          {page === 'discover' && <DiscoverPage />}
          {page === 'manage' && <ManagePage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
      <SearchPalette />
      <DropController />
    </div>
  );
}

function Themed() {
  const { settings } = useApp();
  const mode = useResolvedMode(settings.theme);
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);
  return (
    <Theme theme={kernTheme} mode={mode}>
      <Shell />
    </Theme>
  );
}

export default function App() {
  return (
    <ToastViewport position="bottomEnd" maxVisible={3}>
      <AppProvider>
        <Themed />
      </AppProvider>
    </ToastViewport>
  );
}
