//! Zip handling: finding fonts inside zips/folders, extract status, and safe batch extraction.
use crate::fonts::{self, FaceInfo};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FoundFont {
    /// Where it came from (font file, or the zip that holds it)
    pub origin: String,
    /// Real file on disk to install / preview (temp copy for zip contents)
    pub file: String,
    pub faces: Vec<FaceInfo>,
    pub installed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub fonts: Vec<FoundFont>,
    /// "OFL" | "Apache" | "Personal use only" | "Free for commercial use" | "Unknown"
    pub license: String,
    pub skipped: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ZipInfo {
    pub path: String,
    pub name: String,
    pub target: String,
    pub files: u32,
    pub present: u32,
    pub fonts: u32,
    /// How many of the zip's fonts are already installed (filled by zips_in)
    pub fonts_installed: u32,
    /// "extracted" | "partial" | "not-extracted" | "empty" | "unreadable"
    pub state: String,
    pub size: u64,
    pub modified: u64,
}

fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None, // .., root, drive prefix => unsafe
        }
    }
    if out.as_os_str().is_empty() { None } else { Some(out) }
}

pub fn license_from_text(text: &str) -> Option<&'static str> {
    let t = text.to_lowercase();
    if t.contains("open font license") || (t.contains("ofl") && t.contains("sil")) {
        Some("OFL")
    } else if t.contains("apache license") {
        Some("Apache")
    } else if (t.contains("personal use") || t.contains("non-commercial") || t.contains("noncommercial"))
        && !t.contains("free for commercial")
    {
        Some("Personal use only")
    } else if t.contains("free for commercial") || t.contains("public domain") || t.contains("cc0") {
        Some("Free for commercial use")
    } else {
        None
    }
}

fn is_license_name(name: &str) -> bool {
    let n = name.to_lowercase();
    (n.ends_with(".txt") || n.ends_with(".md") || !n.contains('.'))
        && (n.contains("licen") || n.contains("ofl") || n.contains("readme") || n.contains("read me") || n.contains("eula") || n.contains("info"))
}

/// Walks files/folders/zips, copies fonts found in zips into `temp`, and reports what was found.
pub fn scan_paths(paths: &[String], temp: &Path, installed: &HashSet<String>) -> ScanResult {
    let mut fonts_out = Vec::new();
    let mut license: Option<&'static str> = None;
    let mut skipped = Vec::new();
    let mut seen_files = HashSet::new();
    let mut stack: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let mut n = 0u32;
    while let Some(p) = stack.pop() {
        if p.is_dir() {
            if let Ok(rd) = fs::read_dir(&p) {
                stack.extend(rd.filter_map(|e| e.ok()).map(|e| e.path()));
            }
            continue;
        }
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let lower = name.to_lowercase();
        if fonts::is_font_name(&name) {
            if !seen_files.insert(p.to_string_lossy().to_lowercase()) {
                continue;
            }
            let faces = fonts::parse_file(&p);
            if faces.is_empty() {
                skipped.push(name);
                continue;
            }
            if license.is_none() {
                license = faces.iter().find_map(|f| license_from_text(&f.license));
            }
            let is_inst = faces.iter().all(|f| fonts::face_installed(f, installed));
            fonts_out.push(FoundFont { origin: p.to_string_lossy().into(), file: p.to_string_lossy().into(), faces, installed: is_inst });
        } else if lower.ends_with(".zip") {
            let Ok(file) = fs::File::open(&p) else { skipped.push(name); continue };
            let Ok(mut zip) = zip::ZipArchive::new(file) else { skipped.push(name); continue };
            let mut found_any = false;
            for i in 0..zip.len() {
                let Ok(mut entry) = zip.by_index(i) else { continue };
                if entry.is_dir() {
                    continue;
                }
                let ename = entry.name().to_string();
                let base = Path::new(&ename).file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                if fonts::is_font_name(&ename) {
                    n += 1;
                    let dir = temp.join(format!("{n}"));
                    let _ = fs::create_dir_all(&dir);
                    let dest = dir.join(&base);
                    let mut buf = Vec::new();
                    if entry.read_to_end(&mut buf).is_err() || fs::write(&dest, &buf).is_err() {
                        continue;
                    }
                    let faces = fonts::parse_faces(&buf);
                    if faces.is_empty() {
                        continue;
                    }
                    found_any = true;
                    if license.is_none() {
                        license = faces.iter().find_map(|f| license_from_text(&f.license));
                    }
                    let is_inst = faces.iter().all(|f| fonts::face_installed(f, installed));
                    fonts_out.push(FoundFont { origin: format!("{} › {}", p.to_string_lossy(), ename), file: dest.to_string_lossy().into(), faces, installed: is_inst });
                } else if is_license_name(&base) && entry.size() < 256 * 1024 {
                    let mut s = String::new();
                    if entry.read_to_string(&mut s).is_ok() {
                        if let Some(l) = license_from_text(&s) {
                            // A license file beats the font's embedded notice.
                            license = Some(l);
                        }
                    }
                }
            }
            if !found_any {
                skipped.push(name);
            }
        } else if is_license_name(&name) {
            if let Ok(s) = fs::read_to_string(&p) {
                if let Some(l) = license_from_text(&s) {
                    license = Some(l);
                }
            }
        }
    }
    // Same font dropped twice (e.g. folder + zip) -> keep one.
    let mut seen_faces = HashSet::new();
    fonts_out.retain(|f| {
        let k: Vec<String> = f.faces.iter().map(|x| fonts::face_key(&x.family, &x.style)).collect();
        seen_faces.insert(k.join(","))
    });
    fonts_out.sort_by(|a, b| {
        let fa = &a.faces[0];
        let fb = &b.faces[0];
        (fa.family.to_lowercase(), fa.weight, fa.italic).cmp(&(fb.family.to_lowercase(), fb.weight, fb.italic))
    });
    ScanResult { fonts: fonts_out, license: license.unwrap_or("Unknown").into(), skipped }
}

// ------------------------------------------------------------------ zip status + extraction

/// Google Drive splits big downloads into "Name-20261104T055839Z-1-001.zip", "-002"...; they share one folder.
pub fn zip_target(zip_path: &Path) -> PathBuf {
    let dir = zip_path.parent().unwrap_or(Path::new("."));
    let stem = zip_path.file_stem().and_then(|s| s.to_str()).unwrap_or("archive");
    dir.join(drive_base(stem).unwrap_or(stem))
}

fn drive_base(stem: &str) -> Option<&str> {
    // <base>-YYYYMMDDTHHMMSSZ-<n>-<nnn>
    let parts: Vec<&str> = stem.rsplitn(3, '-').collect();
    if parts.len() != 3 {
        return None;
    }
    let (nnn, n, rest) = (parts[0], parts[1], parts[2]);
    if nnn.len() != 3 || !nnn.chars().all(|c| c.is_ascii_digit()) || n.is_empty() || !n.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let ts = rest.rsplit('-').next()?;
    let ok = ts.len() == 16 && ts.ends_with('Z') && ts.as_bytes()[8] == b'T';
    if ok { Some(rest) } else { None }
}

pub fn zip_info(zip_path: &Path) -> ZipInfo {
    let target = zip_target(zip_path);
    let meta = fs::metadata(zip_path).ok();
    let mut info = ZipInfo {
        path: zip_path.to_string_lossy().into(),
        name: zip_path.file_name().map(|s| s.to_string_lossy().into()).unwrap_or_default(),
        target: target.to_string_lossy().into(),
        files: 0,
        present: 0,
        fonts: 0,
        fonts_installed: 0,
        state: String::new(),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        modified: meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    let archive = fs::File::open(zip_path).ok().and_then(|f| zip::ZipArchive::new(f).ok());
    let Some(mut zip) = archive else {
        info.state = "unreadable".into();
        return info;
    };
    for i in 0..zip.len() {
        let Ok(e) = zip.by_index_raw(i) else { continue };
        if e.is_dir() {
            continue;
        }
        let Some(rel) = safe_relative(e.name()) else { continue };
        info.files += 1;
        if fonts::is_font_name(e.name()) {
            info.fonts += 1;
        }
        if fs::metadata(target.join(rel)).map(|m| m.len() == e.size()).unwrap_or(false) {
            info.present += 1;
        }
    }
    info.state = if info.files == 0 {
        "empty"
    } else if info.present == info.files {
        "extracted"
    } else if info.present == 0 {
        "not-extracted"
    } else {
        "partial"
    }
    .into();
    info
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    pub path: String,
    pub extracted: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
    pub moved_to: Option<String>,
}

pub fn extract(zip_path: &Path, move_after: bool) -> ExtractResult {
    let target = zip_target(zip_path);
    let mut r = ExtractResult { path: zip_path.to_string_lossy().into(), extracted: 0, skipped: 0, errors: vec![], moved_to: None };
    let archive = fs::File::open(zip_path).map_err(|e| e.to_string()).and_then(|f| zip::ZipArchive::new(f).map_err(|e| e.to_string()));
    let mut zip = match archive {
        Ok(z) => z,
        Err(e) => {
            r.errors.push(e);
            return r;
        }
    };
    for i in 0..zip.len() {
        let Ok(mut e) = zip.by_index(i) else { continue };
        let Some(rel) = safe_relative(e.name()) else {
            r.errors.push(format!("Blocked unsafe path: {}", e.name()));
            continue;
        };
        let dest = target.join(rel);
        if e.is_dir() {
            let _ = fs::create_dir_all(&dest);
            continue;
        }
        if fs::metadata(&dest).map(|m| m.len() == e.size()).unwrap_or(false) {
            r.skipped += 1;
            continue;
        }
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match fs::File::create(&dest).and_then(|mut out| std::io::copy(&mut e, &mut out)) {
            Ok(_) => r.extracted += 1,
            Err(err) => r.errors.push(format!("{}: {err}", e.name())),
        }
    }
    drop(zip);
    if move_after && r.errors.is_empty() {
        if let (Some(dir), Some(name)) = (zip_path.parent(), zip_path.file_name()) {
            let done = dir.join("Extracted ZIPs");
            let dest = done.join(name);
            if fs::create_dir_all(&done).is_ok() && !dest.exists() && fs::rename(zip_path, &dest).is_ok() {
                r.moved_to = Some(dest.to_string_lossy().into());
            }
        }
    }
    r
}

/// One font file's faces as (family name, identities) pairs.
type FileFaces = Vec<(String, Vec<String>)>;

/// Parsed fonts per zip / font file, keyed by path + size + date, so a scan only re-reads
/// things that changed.
static FACE_CACHE: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, Vec<FileFaces>>>> =
    std::sync::LazyLock::new(Default::default);

fn faces_of(data: &[u8]) -> Option<FileFaces> {
    let faces = fonts::parse_faces(data);
    if faces.is_empty() {
        return None;
    }
    Some(faces.iter().map(|f| (f.family.clone(), fonts::face_ids(f))).collect())
}

/// `None` from `load` means the file could not be read (still downloading, or locked by the
/// browser or antivirus). That is not stored, so the next scan reads it again.
fn cached(key: String, load: impl FnOnce() -> Option<Vec<FileFaces>>) -> Option<Vec<FileFaces>> {
    if let Some(v) = FACE_CACHE.lock().unwrap().get(&key) {
        return Some(v.clone());
    }
    let v = load()?;
    FACE_CACHE.lock().unwrap().insert(key, v.clone());
    Some(v)
}

/// The later of a file's "created" and "last changed" dates (unix seconds). Copying or moving a
/// file keeps its old "last changed" date, so this is what tells a fresh arrival apart.
fn stamp(meta: &fs::Metadata) -> u64 {
    let secs = |t: std::io::Result<std::time::SystemTime>| t.ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    secs(meta.modified()).max(secs(meta.created()))
}

fn file_fonts(p: &Path, meta: &fs::Metadata) -> Option<Vec<FileFaces>> {
    cached(format!("{}|{}|{}", p.to_string_lossy(), meta.len(), stamp(meta)), || fs::read(p).ok().map(|d| faces_of(&d).into_iter().collect()))
}

fn zip_fonts(path: &str, size: u64, modified: u64) -> Option<Vec<FileFaces>> {
    cached(format!("{path}|{size}|{modified}"), || {
        let mut zip = fs::File::open(path).ok().and_then(|f| zip::ZipArchive::new(f).ok())?;
        let mut out = Vec::new();
        for i in 0..zip.len() {
            let Ok(mut e) = zip.by_index(i) else { continue };
            if e.is_dir() || !fonts::is_font_name(e.name()) {
                continue;
            }
            let mut buf = Vec::new();
            if e.read_to_end(&mut buf).is_ok() {
                if let Some(f) = faces_of(&buf) {
                    out.push(f);
                }
            }
        }
        Some(out)
    })
}

fn zip_font_keys(info: &ZipInfo) -> Vec<Vec<Vec<String>>> {
    zip_fonts(&info.path, info.size, info.modified).unwrap_or_default().into_iter().map(|f| f.into_iter().map(|(_, ids)| ids).collect()).collect()
}

struct FolderFonts {
    files: Vec<FileFaces>,
    /// Newest date of anything inside, so a font added deep down counts as a change to the folder.
    newest: u64,
    unreadable: bool,
}

/// Font files and font zips inside a folder (up to 3 levels deep, at most 400 entries looked at).
fn folder_fonts(dir: &Path, own_stamp: u64) -> FolderFonts {
    let mut out = FolderFonts { files: Vec::new(), newest: own_stamp, unreadable: false };
    let mut stack = vec![(dir.to_path_buf(), 0)];
    let mut seen = 0;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            seen += 1;
            if seen > 400 {
                return out;
            }
            let p = e.path();
            let Ok(meta) = fs::metadata(&p) else { continue };
            out.newest = out.newest.max(stamp(&meta));
            let name = p.to_string_lossy().to_lowercase();
            let found = if meta.is_dir() {
                if depth < 3 {
                    stack.push((p, depth + 1));
                }
                continue;
            } else if fonts::is_font_name(&name) {
                file_fonts(&p, &meta)
            } else if name.ends_with(".zip") {
                zip_fonts(&p.to_string_lossy(), meta.len(), stamp(&meta))
            } else {
                continue;
            };
            match found {
                Some(files) => out.files.extend(files),
                None => out.unreadable = true,
            }
        }
    }
    out
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FontCandidate {
    pub path: String,
    pub name: String,
    /// "zip" | "file" | "folder"
    pub kind: String,
    pub fonts: u32,
    pub fonts_installed: u32,
    /// Family names found inside, most common first
    pub families: Vec<String>,
    /// When it arrived: the later of created / last changed; for a folder, the newest thing inside.
    pub modified: u64,
    pub size: u64,
}

/// Everything in the watched folders that is (or holds) fonts. Non-font zips, documents, videos… are ignored.
pub fn font_candidates(folders: &[String], installed: &HashSet<String>) -> Vec<FontCandidate> {
    font_candidates_report(folders, installed).0
}

/// Like `font_candidates`, plus whether anything could not be read yet (worth another look soon).
pub fn font_candidates_report(folders: &[String], installed: &HashSet<String>) -> (Vec<FontCandidate>, bool) {
    let mut unreadable = false;
    let mut out = Vec::new();
    for folder in folders {
        let Ok(rd) = fs::read_dir(folder) else { continue };
        let entries: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        // A folder that is just an extracted copy of a zip sitting next to it is reported once (as the zip).
        let zip_targets: HashSet<String> = entries
            .iter()
            .filter(|p| p.extension().map(|x| x.eq_ignore_ascii_case("zip")).unwrap_or(false))
            .map(|p| zip_target(p).to_string_lossy().to_lowercase())
            .collect();
        for p in entries {
            let Ok(meta) = fs::metadata(&p) else { continue };
            let mut modified = stamp(&meta);
            let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let path_s = p.to_string_lossy().to_string();
            let (kind, found) = if meta.is_dir() {
                if zip_targets.contains(&path_s.to_lowercase()) || name == "Extracted ZIPs" {
                    continue;
                }
                let f = folder_fonts(&p, modified);
                modified = f.newest;
                unreadable |= f.unreadable;
                ("folder", Some(f.files))
            } else if fonts::is_font_name(&name) {
                ("file", file_fonts(&p, &meta))
            } else if name.to_lowercase().ends_with(".zip") {
                ("zip", zip_fonts(&path_s, meta.len(), modified))
            } else {
                continue;
            };
            let Some(files) = found else {
                unreadable = true;
                continue;
            };
            if files.is_empty() {
                continue;
            }
            let done = files.iter().filter(|f| f.iter().all(|(_, ids)| ids.iter().any(|k| installed.contains(k)))).count() as u32;
            let mut counts: std::collections::HashMap<String, u32> = Default::default();
            for f in &files {
                if let Some((fam, _)) = f.first() {
                    *counts.entry(fam.clone()).or_default() += 1;
                }
            }
            let mut families: Vec<(String, u32)> = counts.into_iter().collect();
            families.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            out.push(FontCandidate {
                path: path_s,
                name,
                kind: kind.into(),
                fonts: files.len() as u32,
                fonts_installed: done,
                families: families.into_iter().map(|(f, _)| f).take(6).collect(),
                modified,
                size: meta.len(),
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    (out, unreadable)
}

/// Zips in the given folders (top level only).
pub fn zips_in(folders: &[String], installed: &HashSet<String>) -> Vec<ZipInfo> {
    let mut out = Vec::new();
    for f in folders {
        let Ok(rd) = fs::read_dir(f) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_file() && p.extension().map(|x| x.eq_ignore_ascii_case("zip")).unwrap_or(false) {
                let mut info = zip_info(&p);
                if info.fonts > 0 {
                    info.fonts_installed = zip_font_keys(&info).iter().filter(|faces| faces.iter().all(|ids| ids.iter().any(|k| installed.contains(k)))).count() as u32;
                }
                out.push(info);
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

pub fn font_paths_in_zip_to(zip_path: &Path, dest_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let Ok(mut e) = zip.by_index(i) else { continue };
        if e.is_dir() || !fonts::is_font_name(e.name()) {
            continue;
        }
        let base = Path::new(e.name()).file_name().map(|s| s.to_owned()).unwrap_or_default();
        let sub = dest_dir.join(format!("{i}"));
        let _ = fs::create_dir_all(&sub);
        let dest = sub.join(base);
        let mut out_f = fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut e, &mut out_f).map_err(|e| e.to_string())?;
        out.push(dest);
    }
    Ok(out)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::windows::fs::OpenOptionsExt;

    fn empty_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fontier-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// A zip holding one real font (Arial ships with every Windows).
    fn font_zip(path: &Path) {
        let font = fs::read(r"C:\Windows\Fonts\arial.ttf").unwrap();
        let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
        z.start_file("pack/Arial.ttf", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(&font).unwrap();
        z.finish().unwrap();
    }

    #[test]
    fn locked_zip_is_read_again_once_free() {
        let dir = empty_dir("locked");
        let zip = dir.join("pack.zip");
        font_zip(&zip);
        let folders = vec![dir.to_string_lossy().to_string()];

        // Like a browser or antivirus holding the new download.
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&zip).unwrap();
        let (found, unreadable) = font_candidates_report(&folders, &HashSet::new());
        assert!(found.is_empty() && unreadable);

        drop(lock);
        let (found, unreadable) = font_candidates_report(&folders, &HashSet::new());
        assert!(!unreadable);
        assert_eq!((found.len(), found[0].fonts), (1, 1));
    }

    #[test]
    fn finds_zips_inside_subfolders() {
        let dir = empty_dir("nested");
        fs::create_dir_all(dir.join("Fonts").join("deeper")).unwrap();
        font_zip(&dir.join("Fonts").join("deeper").join("pack.zip"));
        let (found, _) = font_candidates_report(&[dir.to_string_lossy().to_string()], &HashSet::new());
        assert_eq!((found.len(), found[0].kind.as_str(), found[0].fonts), (1, "folder", 1));
    }
}
