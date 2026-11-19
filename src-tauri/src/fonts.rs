//! Reading font metadata and installing / removing fonts on Windows.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use winreg::enums::*;
use winreg::RegKey;

pub const FONT_EXTS: [&str; 4] = ["ttf", "otf", "ttc", "otc"];
const FONTS_KEY: &str = r"Software\Microsoft\Windows NT\CurrentVersion\Fonts";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FaceInfo {
    pub family: String,
    pub style: String,
    pub full_name: String,
    pub weight: u16,
    pub italic: bool,
    pub version: String,
    pub designer: String,
    pub license: String,
    pub index: u32,
    /// PostScript name (name id 6): the most reliable identity a font carries.
    #[serde(default)]
    pub ps_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFont {
    pub path: String,
    pub reg_name: String,
    /// "system" (Windows\Fonts, protected), "user" (per-user install)
    pub scope: String,
    pub enabled: bool,
    pub size: u64,
    pub modified: u64,
    /// When the file landed on this PC (file creation time) = roughly when it was installed.
    #[serde(default)]
    pub created: u64,
    /// Shipped with Windows (file owned by TrustedInstaller), as opposed to installed by someone.
    #[serde(default)]
    pub os_font: bool,
    pub faces: Vec<FaceInfo>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub source: String,
    pub family: String,
    pub style: String,
    /// "installed" | "skipped" | "failed"
    pub status: String,
    pub message: String,
    pub installed_path: String,
}

pub fn is_font_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("._") || lower.contains("__macosx") {
        return false;
    }
    FONT_EXTS.iter().any(|e| lower.ends_with(&format!(".{e}")))
}

// ------------------------------------------------------------------ parsing

fn pick_name(face: &ttf_parser::Face, id: u16) -> Option<String> {
    let mut fallback = None;
    for n in face.names() {
        if n.name_id != id {
            continue;
        }
        if let Some(s) = n.to_string() {
            if n.language_id == 0x409 || n.platform_id == ttf_parser::PlatformId::Unicode {
                return Some(s);
            }
            fallback.get_or_insert(s);
        }
    }
    fallback
}

pub fn parse_faces(data: &[u8]) -> Vec<FaceInfo> {
    let count = ttf_parser::fonts_in_collection(data).unwrap_or(1);
    let mut out = Vec::new();
    for i in 0..count {
        let Ok(face) = ttf_parser::Face::parse(data, i) else { continue };
        let family = pick_name(&face, 16).or_else(|| pick_name(&face, 1)).unwrap_or_default();
        let style = pick_name(&face, 17).or_else(|| pick_name(&face, 2)).unwrap_or_else(|| "Regular".into());
        if family.is_empty() {
            continue;
        }
        let full_name = pick_name(&face, 4).unwrap_or_else(|| {
            if style == "Regular" { family.clone() } else { format!("{family} {style}") }
        });
        let mut license = pick_name(&face, 13).unwrap_or_default();
        license.truncate(400);
        out.push(FaceInfo {
            family,
            style,
            full_name,
            weight: face.weight().to_number(),
            italic: face.is_italic(),
            version: pick_name(&face, 5).unwrap_or_default(),
            designer: pick_name(&face, 9).or_else(|| pick_name(&face, 8)).unwrap_or_default(),
            license,
            index: i,
            ps_name: pick_name(&face, 6).unwrap_or_default(),
        });
    }
    out
}

pub fn parse_file(path: &Path) -> Vec<FaceInfo> {
    fs::read(path).map(|d| parse_faces(&d)).unwrap_or_default()
}

pub fn reg_name_for(path: &Path, faces: &[FaceInfo]) -> String {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let kind = if ext == "otf" || ext == "otc" { "OpenType" } else { "TrueType" };
    let names: Vec<&str> = faces.iter().map(|f| f.full_name.as_str()).collect();
    format!("{} ({kind})", names.join(" & "))
}

// ------------------------------------------------------------------ locations

pub fn windows_font_dir() -> PathBuf {
    PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into())).join("Fonts")
}

pub fn user_font_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_default().join(r"Microsoft\Windows\Fonts")
}

// ------------------------------------------------------------------ installed index

/// Parse results are cached by path + size + mtime so listing stays fast.
#[derive(Default)]
pub struct FontCache {
    pub entries: Mutex<HashMap<String, (u64, u64, Vec<FaceInfo>)>>,
    pub file: Mutex<Option<PathBuf>>,
}

impl FontCache {
    pub fn load(&self, file: PathBuf) {
        if let Ok(text) = fs::read_to_string(&file) {
            if let Ok(map) = serde_json::from_str(&text) {
                *self.entries.lock().unwrap() = map;
            }
        }
        *self.file.lock().unwrap() = Some(file);
    }
    pub fn save(&self) {
        if let Some(f) = self.file.lock().unwrap().as_ref() {
            if let Ok(text) = serde_json::to_string(&*self.entries.lock().unwrap()) {
                let _ = fs::write(f, text);
            }
        }
    }
    pub fn faces(&self, path: &Path) -> (u64, u64, Vec<FaceInfo>) {
        let meta = fs::metadata(path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let key = path.to_string_lossy().to_lowercase();
        if let Some((s, m, f)) = self.entries.lock().unwrap().get(&key) {
            if *s == size && *m == mtime {
                return (size, mtime, f.clone());
            }
        }
        let faces = parse_file(path);
        self.entries.lock().unwrap().insert(key, (size, mtime, faces.clone()));
        (size, mtime, faces)
    }
}

fn read_reg_fonts(root: &RegKey) -> Vec<(String, String)> {
    let Ok(key) = root.open_subkey(FONTS_KEY) else { return vec![] };
    key.enum_values()
        .filter_map(|v| v.ok())
        .filter_map(|(name, _)| key.get_value::<String, _>(&name).ok().map(|val| (name, val)))
        .collect()
}

pub fn list_registered(cache: &FontCache) -> Vec<InstalledFont> {
    let win = windows_font_dir();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let sources = [
        (RegKey::predef(HKEY_LOCAL_MACHINE), true),
        (RegKey::predef(HKEY_CURRENT_USER), false),
    ];
    for (root, machine) in sources.iter() {
        for (reg_name, value) in read_reg_fonts(root) {
            let p = PathBuf::from(&value);
            let path = if p.is_absolute() { p } else { win.join(&value) };
            if !is_font_name(&path.to_string_lossy()) || !path.exists() {
                continue;
            }
            if !seen.insert(path.to_string_lossy().to_lowercase()) {
                continue;
            }
            let in_windows = path.starts_with(&win);
            let (size, modified, faces) = cache.faces(&path);
            if faces.is_empty() {
                continue;
            }
            out.push(InstalledFont {
                path: path.to_string_lossy().into(),
                reg_name,
                scope: if in_windows || *machine { "system".into() } else { "user".into() },
                enabled: true,
                size,
                modified,
                created: created_time(&path),
                os_font: in_windows && owned_by_trusted_installer(&path),
                faces,
            });
        }
    }
    cache.save();
    out
}

/// Every identity of every installed face. A new font counts as a duplicate if any of its
/// identities is already here, so the same font is never installed twice under another file name.
/// Fonts that ship with Windows (and Windows-update replacements) are owned by TrustedInstaller.
/// Fonts installed by a person or an app, even for all users, are owned by Administrators/the user.
pub fn owned_by_trusted_installer(path: &Path) -> bool {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::OWNER_SECURITY_INFORMATION;
    const TRUSTED_INSTALLER: &str = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    let wpath = wide(&path.to_string_lossy());
    let mut owner: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut sd: *mut core::ffi::c_void = std::ptr::null_mut();
    unsafe {
        let rc = GetNamedSecurityInfoW(
            wpath.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut sd,
        );
        if rc != 0 || owner.is_null() {
            return false;
        }
        let mut sid_str: *mut u16 = std::ptr::null_mut();
        let ok = ConvertSidToStringSidW(owner, &mut sid_str) != 0;
        let mut result = false;
        if ok && !sid_str.is_null() {
            let mut len = 0;
            while *sid_str.add(len) != 0 {
                len += 1;
            }
            result = String::from_utf16_lossy(std::slice::from_raw_parts(sid_str, len)) == TRUSTED_INSTALLER;
            LocalFree(sid_str as _);
        }
        LocalFree(sd as _);
        result
    }
}

pub fn created_time(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn installed_keys(list: &[InstalledFont]) -> HashSet<String> {
    let mut s = HashSet::new();
    for f in list.iter().filter(|f| f.enabled) {
        for face in &f.faces {
            s.extend(face_ids(face));
        }
    }
    s
}

/// family + style, full name and PostScript name, normalised.
pub fn face_ids(face: &FaceInfo) -> Vec<String> {
    let mut ids = vec![face_key(&face.family, &face.style)];
    let norm = |x: &str| x.trim().to_lowercase().replace([' ', '-', '_'], "");
    if !face.full_name.trim().is_empty() {
        ids.push(format!("fn:{}", norm(&face.full_name)));
    }
    if !face.ps_name.trim().is_empty() {
        ids.push(format!("ps:{}", norm(&face.ps_name)));
    }
    ids
}

pub fn face_installed(face: &FaceInfo, installed: &HashSet<String>) -> bool {
    face_ids(face).iter().any(|k| installed.contains(k))
}

pub fn face_key(family: &str, style: &str) -> String {
    format!("{}|{}", family.trim().to_lowercase(), style.trim().to_lowercase())
}

// ------------------------------------------------------------------ Win32

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn gdi_add(path: &str) {
    unsafe {
        windows_sys::Win32::Graphics::Gdi::AddFontResourceW(wide(path).as_ptr());
    }
}

pub fn gdi_remove(path: &str) {
    unsafe {
        windows_sys::Win32::Graphics::Gdi::RemoveFontResourceW(wide(path).as_ptr());
    }
}

pub fn broadcast_font_change() {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let mut result: usize = 0;
    unsafe {
        SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, SMTO_ABORTIFHUNG, 1000, &mut result);
    }
}

// ------------------------------------------------------------------ install / remove (current user)

fn unique_dest(dir: &Path, name: &str, src_len: u64) -> (PathBuf, bool) {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("font").to_string();
    let ext = Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("ttf").to_string();
    let mut dest = dir.join(name);
    let mut n = 1;
    loop {
        match fs::metadata(&dest) {
            Ok(m) if m.len() == src_len => return (dest, true), // identical file already there
            Ok(_) => {
                dest = dir.join(format!("{stem}_{n}.{ext}"));
                n += 1;
            }
            Err(_) => return (dest, false),
        }
    }
}

pub fn install_user(src: &Path, installed: &mut HashSet<String>) -> InstallResult {
    let source = src.to_string_lossy().to_string();
    let faces = parse_file(src);
    let Some(first) = faces.first().cloned() else {
        return InstallResult { source, family: String::new(), style: String::new(), status: "failed".into(), message: "Not a readable font file".into(), installed_path: String::new() };
    };
    let mk = |status: &str, message: String, installed_path: String| InstallResult {
        source: source.clone(),
        family: first.family.clone(),
        style: first.style.clone(),
        status: status.into(),
        message,
        installed_path,
    };
    if faces.iter().all(|f| face_installed(f, installed)) {
        return mk("skipped", "Already installed".into(), String::new());
    }
    let dir = user_font_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        return mk("failed", e.to_string(), String::new());
    }
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("font.ttf");
    let len = fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    let (dest, exists) = unique_dest(&dir, name, len);
    if !exists {
        if let Err(e) = fs::copy(src, &dest) {
            return mk("failed", e.to_string(), String::new());
        }
    }
    let dest_s = dest.to_string_lossy().to_string();
    let reg_name = reg_name_for(&dest, &faces);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.create_subkey(FONTS_KEY) {
        Ok((key, _)) => {
            if let Err(e) = key.set_value(&reg_name, &dest_s) {
                return mk("failed", e.to_string(), String::new());
            }
        }
        Err(e) => return mk("failed", e.to_string(), String::new()),
    }
    gdi_add(&dest_s);
    for f in &faces {
        installed.extend(face_ids(f));
    }
    mk("installed", String::new(), dest_s)
}

fn delete_reg_value_for(path: &str) -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey_with_flags(FONTS_KEY, KEY_READ | KEY_WRITE).ok()?;
    let target = path.to_lowercase();
    let name = key
        .enum_values()
        .filter_map(|v| v.ok())
        .find(|(name, _)| key.get_value::<String, _>(name).map(|v| v.to_lowercase() == target).unwrap_or(false))
        .map(|(n, _)| n)?;
    key.delete_value(&name).ok()?;
    Some(name)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StoredFont {
    pub original_path: String,
    pub stored_path: String,
    pub reg_name: String,
}

/// Removes a per-user font and moves its file into `store_dir` (trash or disabled area).
pub fn remove_user(path: &str, store_dir: &Path) -> Result<StoredFont, String> {
    let p = PathBuf::from(path);
    if p.starts_with(windows_font_dir()) {
        return Err("Windows system fonts are protected".into());
    }
    let faces = parse_file(&p);
    let reg_name = delete_reg_value_for(path).unwrap_or_else(|| reg_name_for(&p, &faces));
    gdi_remove(path);
    fs::create_dir_all(store_dir).map_err(|e| e.to_string())?;
    let name = p.file_name().ok_or("bad path")?;
    let mut stored = store_dir.join(name);
    let mut n = 1;
    while stored.exists() {
        stored = store_dir.join(format!("{n}_{}", name.to_string_lossy()));
        n += 1;
    }
    // The file can stay locked by apps that have the font open; fall back to copy.
    if fs::rename(&p, &stored).is_err() {
        fs::copy(&p, &stored).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&p);
    }
    Ok(StoredFont { original_path: path.into(), stored_path: stored.to_string_lossy().into(), reg_name })
}

/// Puts a stored font back where it was and registers it again.
pub fn restore_user(item: &StoredFont) -> Result<(), String> {
    let orig = PathBuf::from(&item.original_path);
    if let Some(parent) = orig.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if fs::rename(&item.stored_path, &orig).is_err() {
        fs::copy(&item.stored_path, &orig).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&item.stored_path);
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(FONTS_KEY).map_err(|e| e.to_string())?;
    key.set_value(&item.reg_name, &item.original_path).map_err(|e| e.to_string())?;
    gdi_add(&item.original_path);
    Ok(())
}

// ------------------------------------------------------------------ install for all users (admin)

/// Installs into C:\Windows\Fonts via an elevated PowerShell (Windows shows the UAC prompt).
pub fn install_machine(files: &[PathBuf], temp_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(temp_dir).map_err(|e| e.to_string())?;
    let mut script = String::from("$ErrorActionPreference='Continue'\n$fonts = Join-Path $env:WINDIR 'Fonts'\n$key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'\n");
    for f in files {
        let faces = parse_file(f);
        if faces.is_empty() {
            continue;
        }
        let name = f.file_name().unwrap().to_string_lossy().replace('\'', "''");
        let src = f.to_string_lossy().replace('\'', "''");
        let reg = reg_name_for(f, &faces).replace('\'', "''");
        script.push_str(&format!(
            "if (-not (Test-Path (Join-Path $fonts '{name}'))) {{ Copy-Item -LiteralPath '{src}' -Destination $fonts }}\nSet-ItemProperty -Path $key -Name '{reg}' -Value '{name}'\n"
        ));
    }
    let script_path = temp_dir.join("install-all-users.ps1");
    fs::write(&script_path, script).map_err(|e| e.to_string())?;
    let arg = format!(
        "Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"{}\"'",
        script_path.to_string_lossy()
    );
    let status = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &arg])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Administrator approval was declined".into());
    }
    for f in files {
        if let Some(n) = f.file_name() {
            gdi_add(&windows_font_dir().join(n).to_string_lossy());
        }
    }
    Ok(())
}
