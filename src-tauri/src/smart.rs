//! Smart install: watches folders (Downloads by default) and installs fonts the moment they land.
//! The original zip is never touched: fonts are pulled into a temp folder, installed, and the
//! temp folder is deleted. Runs in the backend, so it works while the window is hidden in the tray.
use crate::{archive, fonts, AppState};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmartConfig {
    pub enabled: bool,
    pub folders: Vec<String>,
    /// Only items modified after this (unix seconds) are auto-installed.
    pub since: u64,
    pub scope: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmartEvent {
    pub label: String,
    pub results: Vec<fonts::InstallResult>,
}

#[derive(Default)]
pub struct Smart {
    cfg: Mutex<SmartConfig>,
    handled: Mutex<HashSet<String>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    busy: Mutex<()>,
}

/// Applies new settings and (re)starts the folder watcher.
pub fn configure(app: &AppHandle, cfg: SmartConfig) -> Result<(), String> {
    let smart = app.state::<Smart>();
    let folders = cfg.folders.clone();
    *smart.cfg.lock().unwrap() = cfg;

    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            // Ignore browsers' in-progress files; the final rename to .zip/.ttf fires its own event.
            let interesting = ev.paths.iter().any(|p| {
                let n = p.to_string_lossy().to_lowercase();
                !(n.ends_with(".crdownload") || n.ends_with(".part") || n.ends_with(".tmp") || n.ends_with(".partial"))
            });
            if interesting {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    for f in &folders {
        let _ = watcher.watch(Path::new(f), RecursiveMode::NonRecursive);
    }
    // Replacing the watcher drops the old one, which closes the old channel and ends its worker.
    *smart.watcher.lock().unwrap() = Some(watcher);

    let app2 = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // Debounce: wait until the folder has been quiet for 700 ms (a download finishing fires several events).
            while rx.recv_timeout(Duration::from_millis(700)).is_ok() {}
            let _ = app2.emit("inbox-changed", ());
            run_once(&app2);
        }
    });
    Ok(())
}

/// Installs every new, not-yet-installed font item in the watched folders.
pub fn run_once(app: &AppHandle) {
    let smart = app.state::<Smart>();
    let cfg = smart.cfg.lock().unwrap().clone();
    if !cfg.enabled || cfg.folders.is_empty() {
        return;
    }
    let Ok(_guard) = smart.busy.try_lock() else { return };
    let st = app.state::<AppState>();
    let installed = fonts::installed_keys(&crate::list_all(&st));
    let candidates = archive::font_candidates(&cfg.folders, &installed);
    let mut changed = false;
    for c in candidates {
        if c.modified < cfg.since || c.fonts_installed >= c.fonts {
            continue;
        }
        let key = format!("{}|{}", c.path, c.modified);
        if !smart.handled.lock().unwrap().insert(key) {
            continue;
        }
        let temp: PathBuf = st.temp("auto");
        let keys = fonts::installed_keys(&crate::list_all(&st));
        let scan = archive::scan_paths(&[c.path.clone()], &temp, &keys);
        let files: Vec<PathBuf> = scan.fonts.iter().filter(|f| !f.installed).map(|f| PathBuf::from(&f.file)).collect();
        if !files.is_empty() {
            let results = crate::install_paths(&st, files, &cfg.scope);
            changed = true;
            let label = if c.kind == "file" {
                c.families.first().cloned().unwrap_or(c.name.clone())
            } else {
                c.name.trim_end_matches(".zip").trim_end_matches(".ZIP").to_string()
            };
            let _ = app.emit("smart-installed", SmartEvent { label, results });
        }
        // Unzipped copies were only needed for installing; the original zip stays as it was.
        let _ = std::fs::remove_dir_all(&temp);
    }
    if changed {
        let _ = app.emit("inbox-changed", ());
    }
}
