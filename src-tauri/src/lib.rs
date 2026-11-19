mod archive;
mod fonts;
mod net;
mod smart;

use fonts::{FontCache, InstallResult, InstalledFont, StoredFont};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

struct AppState {
    data: PathBuf,
    cache: PathBuf,
    font_cache: FontCache,
    catalog: Mutex<Option<net::Catalog>>,
    store_lock: Mutex<()>,
}

impl AppState {
    fn disabled_file(&self) -> PathBuf {
        self.data.join("disabled.json")
    }
    fn disabled(&self) -> Vec<StoredFont> {
        fs::read_to_string(self.disabled_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }
    fn save_disabled(&self, v: &[StoredFont]) {
        let _ = fs::write(self.disabled_file(), serde_json::to_string_pretty(v).unwrap_or_default());
    }
    fn temp(&self, what: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        self.cache.join(what).join(stamp.to_string())
    }
}

fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
    async move { tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string()) }
}

fn list_all(state: &AppState) -> Vec<InstalledFont> {
    let mut list = fonts::list_registered(&state.font_cache);
    for d in state.disabled() {
        let p = PathBuf::from(&d.stored_path);
        let (size, modified, faces) = state.font_cache.faces(&p);
        if faces.is_empty() {
            continue;
        }
        list.push(InstalledFont { path: d.stored_path.clone(), reg_name: d.reg_name.clone(), scope: "user".into(), enabled: false, size, modified, created: fonts::created_time(&p), os_font: false, faces });
    }
    list
}

#[tauri::command]
async fn list_installed(app: AppHandle) -> Result<Vec<InstalledFont>, String> {
    blocking(move || list_all(&app.state::<AppState>())).await
}

#[tauri::command]
async fn scan_paths(app: AppHandle, paths: Vec<String>) -> Result<archive::ScanResult, String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let installed = fonts::installed_keys(&list_all(&st));
        archive::scan_paths(&paths, &st.temp("scan"), &installed)
    })
    .await
}

fn install_paths(st: &AppState, files: Vec<PathBuf>, scope: &str) -> Vec<InstallResult> {
    let mut installed = fonts::installed_keys(&list_all(st));
    if scope == "machine" {
        let (todo, done): (Vec<PathBuf>, Vec<PathBuf>) = files.into_iter().partition(|f| {
            let faces = fonts::parse_file(f);
            !faces.is_empty() && !faces.iter().all(|x| fonts::face_installed(x, &installed))
        });
        let mut results: Vec<InstallResult> = done
            .iter()
            .map(|f| {
                let face = fonts::parse_file(f).into_iter().next();
                InstallResult { source: f.to_string_lossy().into(), family: face.as_ref().map(|x| x.family.clone()).unwrap_or_default(), style: face.map(|x| x.style).unwrap_or_default(), status: "skipped".into(), message: "Already installed".into(), installed_path: String::new() }
            })
            .collect();
        let outcome = fonts::install_machine(&todo, &st.temp("elevated"));
        for f in &todo {
            let face = fonts::parse_file(f).into_iter().next();
            let dest = fonts::windows_font_dir().join(f.file_name().unwrap());
            let ok = outcome.is_ok() && dest.exists();
            results.push(InstallResult {
                source: f.to_string_lossy().into(),
                family: face.as_ref().map(|x| x.family.clone()).unwrap_or_default(),
                style: face.map(|x| x.style).unwrap_or_default(),
                status: if ok { "installed" } else { "failed" }.into(),
                message: outcome.as_ref().err().cloned().unwrap_or_default(),
                installed_path: if ok { dest.to_string_lossy().into() } else { String::new() },
            });
        }
        fonts::broadcast_font_change();
        return results;
    }
    let results = files.iter().map(|f| fonts::install_user(f, &mut installed)).collect();
    fonts::broadcast_font_change();
    results
}

#[tauri::command]
async fn install_files(app: AppHandle, files: Vec<String>, scope: String) -> Result<Vec<InstallResult>, String> {
    blocking(move || install_paths(&app.state::<AppState>(), files.into_iter().map(PathBuf::from).collect(), &scope)).await
}

#[tauri::command]
async fn uninstall(app: AppHandle, paths: Vec<String>) -> Result<Vec<StoredFont>, String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let trash = st.temp("trash");
        let mut out = Vec::new();
        let mut disabled = st.disabled();
        for p in paths {
            // A switched-off font is already out of Windows; just move it to trash.
            if let Some(i) = disabled.iter().position(|d| d.stored_path == p) {
                let d = disabled.remove(i);
                let _ = fs::create_dir_all(&trash);
                let dest = trash.join(Path::new(&d.stored_path).file_name().unwrap());
                if fs::rename(&d.stored_path, &dest).is_ok() {
                    out.push(StoredFont { original_path: d.original_path, stored_path: dest.to_string_lossy().into(), reg_name: d.reg_name });
                }
                continue;
            }
            if let Ok(s) = fonts::remove_user(&p, &trash) {
                out.push(s);
            }
        }
        st.save_disabled(&disabled);
        fonts::broadcast_font_change();
        out
    })
    .await
}

#[tauri::command]
async fn restore(items: Vec<StoredFont>) -> Result<u32, String> {
    blocking(move || {
        let n = items.iter().filter(|i| fonts::restore_user(i).is_ok()).count() as u32;
        fonts::broadcast_font_change();
        n
    })
    .await
}

#[tauri::command]
async fn set_enabled(app: AppHandle, paths: Vec<String>, enabled: bool) -> Result<u32, String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _g = st.store_lock.lock().unwrap();
        let mut disabled = st.disabled();
        let mut n = 0;
        for p in paths {
            if enabled {
                if let Some(i) = disabled.iter().position(|d| d.stored_path == p) {
                    if fonts::restore_user(&disabled[i]).is_ok() {
                        disabled.remove(i);
                        n += 1;
                    }
                }
            } else if let Ok(s) = fonts::remove_user(&p, &st.data.join("disabled")) {
                disabled.push(s);
                n += 1;
            }
        }
        st.save_disabled(&disabled);
        fonts::broadcast_font_change();
        n
    })
    .await
}

#[tauri::command]
async fn catalog(state: State<'_, AppState>, force: bool) -> Result<Value, String> {
    if !force {
        if let Some(c) = state.catalog.lock().unwrap().as_ref() {
            return serde_json::to_value(c).map_err(|e| e.to_string());
        }
    }
    let c = net::load_catalog(&state.data.join("catalog.json"), force).await?;
    let v = serde_json::to_value(&c).map_err(|e| e.to_string())?;
    *state.catalog.lock().unwrap() = Some(c);
    Ok(v)
}

#[tauri::command]
async fn install_family(
    app: AppHandle,
    family_id: String,
    styles: Option<Vec<String>>,
    prefer_static: bool,
    scope: String,
    job_id: String,
) -> Result<Vec<InstallResult>, String> {
    let st = app.state::<AppState>();
    let fam = st
        .catalog
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|c| c.families.iter().find(|f| f.id == family_id).cloned())
        .ok_or("Family not found in library")?;
    let dir = st.temp("download");
    let fail = |msg: String| {
        net::emit(&app, net::Progress { job_id: job_id.clone(), family: fam.family.clone(), stage: "error".into(), done: 0, total: 0, message: msg.clone() });
        msg
    };
    let files = net::fetch_family_files(&app, &fam, &styles, prefer_static, &dir, &job_id).await.map_err(fail)?;
    net::emit(&app, net::Progress { job_id: job_id.clone(), family: fam.family.clone(), stage: "installing".into(), done: 0, total: files.len() as u32, message: String::new() });
    let app2 = app.clone();
    let results = blocking(move || install_paths(&app2.state::<AppState>(), files, &scope)).await?;
    net::emit(&app, net::Progress { job_id, family: fam.family.clone(), stage: "done".into(), done: results.len() as u32, total: results.len() as u32, message: String::new() });
    Ok(results)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFile {
    file: String,
    faces: Vec<fonts::FaceInfo>,
}

#[tauri::command]
async fn squirrel_preview(state: State<'_, AppState>, url_name: String) -> Result<Vec<PreviewFile>, String> {
    let dir = state.cache.join("squirrel");
    let files = net::squirrel_files(&url_name, &dir).await?;
    Ok(files.into_iter().map(|f| PreviewFile { faces: fonts::parse_file(&f), file: f.to_string_lossy().into() }).collect())
}

#[tauri::command]
async fn read_font_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let data = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

#[tauri::command]
async fn font_inbox(app: AppHandle, folders: Vec<String>) -> Result<Vec<archive::FontCandidate>, String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let installed = fonts::installed_keys(&list_all(&st));
        archive::font_candidates(&folders, &installed)
    })
    .await
}

#[tauri::command]
async fn zips_status(app: AppHandle, folders: Vec<String>) -> Result<Vec<archive::ZipInfo>, String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let installed = fonts::installed_keys(&list_all(&st));
        archive::zips_in(&folders, &installed)
    })
    .await
}

#[tauri::command]
async fn zip_info(paths: Vec<String>) -> Result<Vec<archive::ZipInfo>, String> {
    blocking(move || paths.iter().map(|p| archive::zip_info(Path::new(p))).collect()).await
}

#[tauri::command]
async fn extract_zips(paths: Vec<String>, move_after: bool) -> Result<Vec<archive::ExtractResult>, String> {
    blocking(move || paths.iter().map(|p| archive::extract(Path::new(p), move_after)).collect()).await
}

#[tauri::command]
async fn running_apps() -> Result<Vec<String>, String> {
    blocking(|| {
        use sysinfo::{ProcessesToUpdate, System};
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let known = [
            ("photoshop.exe", "Photoshop"),
            ("illustrator.exe", "Illustrator"),
            ("indesign.exe", "InDesign"),
            ("afterfx.exe", "After Effects"),
            ("adobe premiere pro.exe", "Premiere Pro"),
            ("figma.exe", "Figma"),
            ("winword.exe", "Word"),
            ("powerpnt.exe", "PowerPoint"),
            ("excel.exe", "Excel"),
            ("resolve.exe", "DaVinci Resolve"),
            ("canva.exe", "Canva"),
            ("blender.exe", "Blender"),
            ("coreldrw.exe", "CorelDRAW"),
        ];
        let mut out: Vec<String> = Vec::new();
        for p in sys.processes().values() {
            let name = p.name().to_string_lossy().to_lowercase();
            if let Some((_, nice)) = known.iter().find(|(exe, _)| *exe == name) {
                if !out.iter().any(|x| x == nice) {
                    out.push(nice.to_string());
                }
            }
        }
        out
    })
    .await
}

#[tauri::command]
fn store_get(state: State<'_, AppState>, key: String) -> Value {
    let _g = state.store_lock.lock().unwrap();
    let safe: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    fs::read_to_string(state.data.join(format!("store-{safe}.json"))).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

#[tauri::command]
fn store_set(state: State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    let _g = state.store_lock.lock().unwrap();
    let safe: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    fs::write(state.data.join(format!("store-{safe}.json")), serde_json::to_string(&value).unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_zip(paths: Vec<String>, dest: String) -> Result<u32, String> {
    blocking(move || -> Result<u32, String> {
        let f = fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut zw = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut names = std::collections::HashSet::new();
        let mut n = 0;
        for p in paths {
            let Ok(data) = fs::read(&p) else { continue };
            let base = Path::new(&p).file_name().unwrap().to_string_lossy().to_string();
            let mut name = base.clone();
            let mut i = 1;
            while !names.insert(name.clone()) {
                name = format!("{i}_{base}");
                i += 1;
            }
            zw.start_file(name, opts).map_err(|e| e.to_string())?;
            std::io::Write::write_all(&mut zw, &data).map_err(|e| e.to_string())?;
            n += 1;
        }
        zw.finish().map_err(|e| e.to_string())?;
        Ok(n)
    })
    .await?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheInfo {
    bytes: u64,
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = fs::read_dir(p) {
        for e in rd.filter_map(|e| e.ok()) {
            let path = e.path();
            total += if path.is_dir() { dir_size(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) };
        }
    }
    total
}

#[tauri::command]
async fn cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    blocking(move || CacheInfo { bytes: dir_size(&app.state::<AppState>().cache) }).await
}

#[tauri::command]
async fn clear_cache(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let c = app.state::<AppState>().cache.clone();
        for sub in ["scan", "download", "squirrel", "elevated"] {
            let _ = fs::remove_dir_all(c.join(sub));
        }
    })
    .await
}

#[tauri::command]
fn downloads_dir() -> String {
    dirs::download_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

#[tauri::command]
fn configure_smart(app: AppHandle, config: smart::SmartConfig) -> Result<(), String> {
    smart::configure(&app, config)
}

/// Whether the window's close button hides Fontier to the tray (true) or quits.
static KEEP_IN_TRAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
fn set_keep_in_tray(keep: bool) {
    KEEP_IN_TRAY.store(keep, std::sync::atomic::Ordering::Relaxed);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        // When another program starts Fontier (an installer, a second launch), Windows may refuse to
        // hand over focus and the window opens behind everything. Briefly topmost puts it in front.
        let _ = w.set_always_on_top(true);
        let _ = w.set_always_on_top(false);
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open Fontier", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Fontier", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;
    TrayIconBuilder::with_id("main")
        // Simplified mark: the construction lines of the full icon turn to noise at tray size.
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .tooltip("Fontier")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (Start menu, desktop icon) just brings the running Fontier forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if KEEP_IN_TRAY.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            build_tray(app)?;
            app.manage(smart::Smart::default());
            // Started by Windows at sign-in: stay in the tray. Otherwise show the window.
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(app.handle());
            }
            let data = app.path().app_data_dir()?;
            let cache = app.path().app_cache_dir()?;
            fs::create_dir_all(&data)?;
            fs::create_dir_all(&cache)?;
            // Old temp work from previous sessions.
            for sub in ["scan", "download", "elevated", "trash", "auto"] {
                let _ = fs::remove_dir_all(cache.join(sub));
            }
            let font_cache = FontCache::default();
            font_cache.load(cache.join("font-index-v2.json"));
            app.manage(AppState { data, cache, font_cache, catalog: Mutex::new(None), store_lock: Mutex::new(()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_installed,
            scan_paths,
            install_files,
            uninstall,
            restore,
            set_enabled,
            catalog,
            install_family,
            squirrel_preview,
            read_font_bytes,
            zips_status,
            font_inbox,
            zip_info,
            extract_zips,
            running_apps,
            store_get,
            store_set,
            export_zip,
            cache_info,
            clear_cache,
            downloads_dir,
            configure_smart,
            set_keep_in_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
