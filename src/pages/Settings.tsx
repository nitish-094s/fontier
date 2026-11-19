import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Monitor, Moon, Sun, X, FolderPlus } from 'lucide-react';
import { useApp } from '../lib/state';
import { api, formatBytes } from '../lib/api';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { SOURCE_LABEL, type Source, type ThemeMode } from '../lib/types';

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="s-section">
      <div className="s-label">
        <Heading level={3}>{title}</Heading>
        {desc && <div className="muted small">{desc}</div>}
      </div>
      <div className="s-control">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { settings, updateSettings, loadCatalog, catalog, catalogLoading } = useApp();
  const [cache, setCache] = useState<number | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    isAutostartEnabled().then(setAutostart).catch(() => setAutostart(false));
  }, []);
  const [previewDraft, setPreviewDraft] = useState(settings.previewText);
  useEffect(() => {
    api.cacheInfo().then((c) => setCache(c.bytes));
  }, []);

  return (
    <div className="settings">
      <Heading level={1} className="page-title">
        Settings
      </Heading>

      <Section title="Theme" desc="Light is white with a mint glow; dark is black with an orange glow.">
        <SegmentedControl label="Theme" value={settings.theme} onChange={(v) => updateSettings({ theme: v as ThemeMode })}>
          <SegmentedControlItem value="system" label="System" icon={<Monitor size={15} />} />
          <SegmentedControlItem value="light" label="Light" icon={<Sun size={15} />} />
          <SegmentedControlItem value="dark" label="Dark" icon={<Moon size={15} />} />
        </SegmentedControl>
      </Section>

      <Section title="Install fonts for" desc="“Everyone” asks for administrator approval. Some older apps only see fonts installed for everyone.">
        <SegmentedControl label="Install scope" value={settings.scope} onChange={(v) => updateSettings({ scope: v as 'user' | 'machine' })}>
          <SegmentedControlItem value="user" label="Just me" />
          <SegmentedControlItem value="machine" label="Everyone on this PC" />
        </SegmentedControl>
      </Section>

      <Section title="Google font files" desc="Static files work in every app. Variable files are smaller and allow any weight, but some apps (older Office, some Adobe versions) handle them poorly.">
        <SegmentedControl label="Google font files" value={settings.preferStatic ? 'static' : 'variable'} onChange={(v) => updateSettings({ preferStatic: v === 'static' })}>
          <SegmentedControlItem value="static" label="Static (recommended)" />
          <SegmentedControlItem value="variable" label="Variable" />
        </SegmentedControl>
      </Section>

      <Section title="Watched folders" desc="Fonts that land here show up on Home, and Smart install picks them up.">
        <div className="folder-list">
          {settings.watchFolders.map((f) => (
            <div key={f} className="folder-row">
              <span title={f}>{f}</span>
              <IconButton size="sm" variant="ghost" label="Stop watching" tooltip="Stop watching" icon={<X size={14} />} onClick={() => updateSettings({ watchFolders: settings.watchFolders.filter((x) => x !== f) })} />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            label="Add folder"
            icon={<FolderPlus size={14} />}
            onClick={async () => {
              const p = await openDialog({ directory: true });
              if (typeof p === 'string' && !settings.watchFolders.includes(p)) updateSettings({ watchFolders: [...settings.watchFolders, p] });
            }}
          />
        </div>
      </Section>

      <Section
        title="Smart install"
        desc="When a font file, a zip with fonts or a folder of fonts lands in a watched folder, Fontier installs it right away. Zips stay exactly as they were."
      >
        <Switch label="Install new fonts automatically" description="Only new arrivals. Works while Fontier is in the tray; each install shows an Undo." value={settings.autoInstall} onChange={(v) => updateSettings({ autoInstall: v })} />
      </Section>

      <Section title="Startup and tray" desc="Fontier lives in the system tray so Smart install can keep working when the window is closed.">
        <Switch label="Start Fontier when Windows starts" description="Opens quietly in the tray at sign-in." value={autostart ?? false} isDisabled={autostart === null} changeAction={async (v) => {
          if (v) await enableAutostart();
          else await disableAutostart();
          setAutostart(await isAutostartEnabled());
        }} />
        <Switch label="Keep running in the tray when closed" description="The close button hides the window. Quit from the tray icon." value={settings.keepInTray} onChange={(v) => updateSettings({ keepInTray: v })} />
      </Section>

      <Section title="Font libraries" desc={catalog ? `Library updated ${new Date(catalog.fetchedAt * 1000).toLocaleString()}. It refreshes every 3 days and works offline in between.` : undefined}>
        {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
          <Switch key={s} label={SOURCE_LABEL[s]} value={settings.sources[s]} onChange={(v) => updateSettings({ sources: { ...settings.sources, [s]: v } })} />
        ))}
        <div>
          <Button size="sm" label="Refresh library now" isLoading={catalogLoading} onClick={() => loadCatalog(true)} />
        </div>
      </Section>

      <Section title="Default preview text" desc="Used in Discover and Manage when you open the app.">
        <TextInput label="Default preview text" isLabelHidden value={previewDraft} onChange={setPreviewDraft} placeholder="The quick brown fox jumps over the lazy dog" width={420} />
        <div>
          <Button size="sm" label="Save" isDisabled={previewDraft === settings.previewText} onClick={() => updateSettings({ previewText: previewDraft })} />
        </div>
      </Section>

      <Section title="Cache" desc="Preview downloads and temporary files. Installed fonts are never touched.">
        <div className="row-gap">
          <span className="num">{cache === null ? '…' : formatBytes(cache)}</span>
          <Button
            size="sm"
            variant="ghost"
            label="Clear cache"
            clickAction={async () => {
              await api.clearCache();
              setCache((await api.cacheInfo()).bytes);
            }}
          />
        </div>
      </Section>

      <Section title="Keyboard shortcuts">
        <div className="shortcuts">
          <span>Search everything</span>
          <Kbd keys="ctrl+k" />
          <span>Close a dialog</span>
          <Kbd keys="esc" />
        </div>
      </Section>

      <Section title="About">
        <div className="muted small">
          Fontier 0.1
        </div>
      </Section>
    </div>
  );
}
