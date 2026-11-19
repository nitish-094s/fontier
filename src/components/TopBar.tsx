import { useEffect, useState } from 'react';
import { SlidingTabs } from './SlidingTabs';
import logoUrl from '../assets/fontier-icon.svg';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Search, Settings2 } from 'lucide-react';
import { useApp, type Page } from '../lib/state';
import { QueueButton } from './QueueButton';

const NAV: { id: Page; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'discover', label: 'Discover' },
  { id: 'manage', label: 'Manage' },
];

/** Same artwork as the app icon (design/fontier-icon.svg). */
export function Logo() {
  return <img src={logoUrl} width={30} height={30} alt="" className="brand-logo" draggable={false} />;
}

/** macOS-style window buttons: close, minimise, zoom. Symbols show when the group is hovered; grey when the window is in the background. */
function TrafficLights() {
  const win = getCurrentWindow();
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const un = win.onFocusChanged(({ payload }) => setFocused(payload));
    return () => {
      un.then((f) => f());
    };
  }, [win]);
  return (
    <div className={`traffic ${focused ? '' : 'inactive'}`}>
      <button className="tl close" aria-label="Close" onClick={() => win.close()}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.8 3.8l4.4 4.4M8.2 3.8l-4.4 4.4" />
        </svg>
      </button>
      <button className="tl min" aria-label="Minimize" onClick={() => win.minimize()}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.2 6h5.6" />
        </svg>
      </button>
      <button className="tl zoom" aria-label="Maximize" onClick={() => win.toggleMaximize()}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path className="fill" d="M3.4 3.4h3.6L3.4 7z M8.6 8.6H5L8.6 5z" />
        </svg>
      </button>
    </div>
  );
}

/** Main nav: the same sliding pill used for page filters. */
function NavPill() {
  const { page, go } = useApp();
  return (
    <nav className="nav">
      <SlidingTabs label="Main" items={NAV} value={NAV.some((n) => n.id === page) ? page : null} onChange={(id) => go(id as Page)} />
    </nav>
  );
}

export function TopBar() {
  const { page, go, setSearchOpen } = useApp();
  const win = getCurrentWindow();
  return (
    <header className="topbar" data-tauri-drag-region onDoubleClick={(e) => e.target === e.currentTarget && win.toggleMaximize()}>
      <TrafficLights />
      <div className="brand" data-tauri-drag-region>
        <Logo />
        <span className="brand-name">Fontier</span>
      </div>
      <NavPill />
      <div className="topbar-spacer" data-tauri-drag-region />
      <button className="search-trigger" onClick={() => setSearchOpen(true)}>
        <Search size={15} />
        <span>Search fonts</span>
        <Kbd keys="ctrl+k" />
      </button>
      <QueueButton />
      <IconButton
        label="Settings"
        tooltip="Settings"
        variant={page === 'settings' ? 'secondary' : 'ghost'}
        icon={<Settings2 size={18} />}
        onClick={() => go('settings')}
      />
    </header>
  );
}
