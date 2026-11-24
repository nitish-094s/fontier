//! Smart install: watches folders (Downloads by default) and installs fonts the moment they land.
//! The original zip is never touched: fonts are pulled into a temp folder, installed, and the
//! temp folder is deleted. Runs in the backend, so it works while the window is hidden in the tray.
use crate::{archive, fonts, AppState};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Something could not be read or installed yet: look again after this long, at most this many times.
const RETRY_AFTER: Duration = Duration::from_secs(6);
const MAX_RETRIES: u32 = 5;
/// Install attempts per item before it is left alone (a broken font should not toast forever).
const MAX_FAILURES: u32 = 3;

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmartConfig {
    pub enabled: bool,
    pub folders: Vec<String>,
    /// Only items that arrived after this (unix seconds) are auto-installed.
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
    /// Items (path|arrival) that are fully installed or were given up on.
    handled: Mutex<HashSet<String>>,
    failures: Mutex<HashMap<String, u32>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    busy: Mutex<()>,
    /// A scan was asked for while another was running: the running one goes round once more.
    rerun: AtomicBool,
}

/// Browsers' in-progress files; the final rename to .zip/.ttf fires its own event.
fn is_partial(p: &Path) -> bool {
    let n = p.to_string_lossy().to_lowercase();
    n.ends_with(".crdownload") || n.ends_with(".part") || n.ends_with(".tmp") || n.ends_with(".partial")
}

/// Applies new settings and (re)starts the folder watcher.
pub fn configure(app: &AppHandle, cfg: SmartConfig) -> Result<(), String> {
    let smart = app.state::<Smart>();
    let folders = cfg.folders.clone();
    *smart.cfg.lock().unwrap() = cfg;

    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // An error usually means Windows dropped events in a burst: scan anyway.
        let interesting = match res {
            Ok(ev) => ev.paths.iter().any(|p| !is_partial(p)),
            Err(_) => true,
        };
        if interesting {
            let _ = tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;
    for f in &folders {
        // Subfolders too: browsers that sort downloads and Explorer's "Extract all" write below the top.
        if let Err(e) = watcher.watch(Path::new(f), RecursiveMode::Recursive) {
            eprintln!("Smart install cannot watch {f}: {e}");
        }
    }
    // Replacing the watcher drops the old one, which closes the old channel and ends its worker.
    *smart.watcher.lock().unwrap() = Some(watcher);

    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut retries = 0;
        // The first round runs straight away: fonts that arrived while Fontier was closed.
        loop {
            let _ = app2.emit("inbox-changed", ());
            retries = if run_once(&app2) { retries + 1 } else { 0 };
            let got_event = if retries > 0 && retries <= MAX_RETRIES {
                match rx.recv_timeout(RETRY_AFTER) {
                    Ok(()) => true,
                    Err(RecvTimeoutError::Timeout) => false,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            } else if rx.recv().is_ok() {
                true
            } else {
                break;
            };
            if got_event {
                retries = 0;
                // Debounce: wait until the folder has been quiet for 700 ms (a download finishing fires several events).
                loop {
                    match rx.recv_timeout(Duration::from_millis(700)) {
                        Ok(()) => {}
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            }
        }
    });
    Ok(())
}

/// Installs every new, not-yet-installed font item in the watched folders.
/// Returns true when something could not be read or installed yet and is worth another try.
pub fn run_once(app: &AppHandle) -> bool {
    let smart = app.state::<Smart>();
    let Ok(_guard) = smart.busy.try_lock() else {
        smart.rerun.store(true, Ordering::SeqCst);
        return false;
    };
    loop {
        let retry = scan_and_install(app, &smart);
        if !smart.rerun.swap(false, Ordering::SeqCst) {
            return retry;
        }
    }
}

fn scan_and_install(app: &AppHandle, smart: &Smart) -> bool {
    let cfg = smart.cfg.lock().unwrap().clone();
    if !cfg.enabled || cfg.folders.is_empty() {
        return false;
    }
    let st = app.state::<AppState>();
    let mut installed = fonts::installed_keys(&crate::list_all(&st));
    let (candidates, mut retry) = archive::font_candidates_report(&cfg.folders, &installed);
    let mut changed = false;
    for c in candidates {
        if c.modified < cfg.since || c.fonts_installed >= c.fonts {
            continue;
        }
        let key = format!("{}|{}", c.path, c.modified);
        if smart.handled.lock().unwrap().contains(&key) {
            continue;
        }
        let temp: PathBuf = st.temp("auto");
        let scan = archive::scan_paths(&[c.path.clone()], &temp, &installed);
        let files: Vec<PathBuf> = scan.fonts.iter().filter(|f| !f.installed).map(|f| PathBuf::from(&f.file)).collect();
        let results = if files.is_empty() { Vec::new() } else { crate::install_paths_with(&st, files, &cfg.scope, &mut installed) };
        // Unzipped copies were only needed for installing; the original zip stays as it was.
        let _ = std::fs::remove_dir_all(&temp);

        let failed = scan.fonts.is_empty() || results.iter().any(|r| r.status == "failed");
        let give_up = failed && {
            let mut failures = smart.failures.lock().unwrap();
            let n = failures.entry(key.clone()).or_insert(0);
            *n += 1;
            *n >= MAX_FAILURES
        };
        if !failed || give_up {
            smart.handled.lock().unwrap().insert(key);
        } else {
            retry = true;
        }
        // Toast what got installed; failures only once, when giving up.
        if results.iter().any(|r| r.status == "installed") || (give_up && !results.is_empty()) {
            changed = true;
            let label = match c.kind.as_str() {
                "file" => c.families.first().cloned().unwrap_or(c.name.clone()),
                "zip" => Path::new(&c.name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or(c.name.clone()),
                _ => c.name.clone(),
            };
            let _ = app.emit("smart-installed", SmartEvent { label, results });
        }
    }
    if changed {
        let _ = app.emit("inbox-changed", ());
    }
    retry
}
