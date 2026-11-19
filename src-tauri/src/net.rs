//! Online font library: building the catalog and downloading families.
use crate::archive;
use crate::fonts;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const UA: &str = "Fontier/0.1 (desktop font manager)";

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .expect("http client")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub tag: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFamily {
    pub id: String,
    pub family: String,
    /// "google" | "fontsource" | "fontsquirrel"
    pub source: String,
    /// "sans" | "serif" | "display" | "handwriting" | "mono"
    pub category: String,
    pub designer: String,
    /// "400", "700i" ...
    pub styles: Vec<String>,
    pub style_count: u32,
    pub variable: bool,
    pub axes: Vec<Axis>,
    pub subsets: Vec<String>,
    pub license: String,
    pub popularity: u32,
    pub date_added: String,
    pub last_modified: String,
    pub fs_id: Option<String>,
    pub sq_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub fetched_at: u64,
    pub families: Vec<CatalogFamily>,
    pub errors: Vec<String>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn map_google_cat(c: &str) -> &'static str {
    match c {
        "Serif" => "serif",
        "Display" => "display",
        "Handwriting" => "handwriting",
        "Monospace" => "mono",
        _ => "sans",
    }
}

fn map_fontsource_cat(c: &str) -> &'static str {
    match c {
        "serif" => "serif",
        "display" => "display",
        "handwriting" => "handwriting",
        "monospace" => "mono",
        _ => "sans",
    }
}

fn map_squirrel_cat(c: &str) -> &'static str {
    match c {
        "Sans Serif" => "sans",
        "Serif" | "Slab Serif" => "serif",
        "Script" | "Calligraphic" | "Handdrawn" => "handwriting",
        "Monospaced" | "Programming" | "Typewriter" => "mono",
        _ => "display",
    }
}

async fn get_json(url: &str) -> Result<Value, String> {
    let text = client().get(url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let text = text.trim_start_matches(")]}'").trim_start();
    serde_json::from_str(text).map_err(|e| format!("{url}: {e}"))
}

pub async fn fetch_catalog() -> Catalog {
    let (gf, fsrc, sq) = tokio::join!(
        get_json("https://fonts.google.com/metadata/fonts"),
        get_json("https://api.fontsource.org/v1/fonts"),
        get_json("https://www.fontsquirrel.com/api/fontlist/all"),
    );
    let mut errors = Vec::new();
    let mut families = Vec::new();

    // Fontsource rows, by family name (gives license + preview CDN id for Google fonts too).
    let mut fs_by_family: HashMap<String, Value> = HashMap::new();
    let fs_rows = match fsrc {
        Ok(Value::Array(a)) => a,
        Ok(_) => vec![],
        Err(e) => {
            errors.push(format!("Fontsource: {e}"));
            vec![]
        }
    };
    for r in &fs_rows {
        fs_by_family.insert(s(r, "family").to_lowercase(), r.clone());
    }

    match gf {
        Ok(v) => {
            for f in v.get("familyMetadataList").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
                let family = s(&f, "family");
                let fsr = fs_by_family.get(&family.to_lowercase());
                let mut styles: Vec<String> = f.get("fonts").and_then(|x| x.as_object()).map(|o| o.keys().cloned().collect()).unwrap_or_default();
                styles.sort_by_key(|k| (k.ends_with('i'), k.trim_end_matches('i').parse::<u32>().unwrap_or(400)));
                let axes: Vec<Axis> = f
                    .get("axes")
                    .and_then(|x| x.as_array())
                    .map(|a| {
                        a.iter()
                            .map(|ax| Axis {
                                tag: s(ax, "tag"),
                                min: ax.get("min").and_then(|x| x.as_f64()).unwrap_or(0.0),
                                max: ax.get("max").and_then(|x| x.as_f64()).unwrap_or(0.0),
                                default: ax.get("defaultValue").and_then(|x| x.as_f64()).unwrap_or(0.0),
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let designers: Vec<String> = f.get("designers").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|d| d.as_str().map(String::from)).collect()).unwrap_or_default();
                let subsets: Vec<String> = f.get("subsets").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|d| d.as_str().map(String::from)).filter(|x| x != "menu").collect()).unwrap_or_default();
                families.push(CatalogFamily {
                    id: format!("g:{family}"),
                    style_count: styles.len() as u32,
                    styles,
                    variable: !axes.is_empty(),
                    axes,
                    category: map_google_cat(&s(&f, "category")).into(),
                    designer: designers.join(", "),
                    subsets,
                    license: fsr.map(|r| s(r, "license")).filter(|l| !l.is_empty()).unwrap_or_else(|| "OFL-1.1".into()),
                    popularity: f.get("popularity").and_then(|x| x.as_u64()).unwrap_or(99999) as u32,
                    date_added: s(&f, "dateAdded"),
                    last_modified: s(&f, "lastModified"),
                    fs_id: fsr.map(|r| s(r, "id")),
                    sq_url: None,
                    source: "google".into(),
                    family,
                });
            }
        }
        Err(e) => errors.push(format!("Google Fonts: {e}")),
    }

    for r in fs_rows.iter().filter(|r| s(r, "type") != "google") {
        let weights: Vec<u64> = r.get("weights").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|w| w.as_u64()).collect()).unwrap_or_default();
        let italic = r.get("styles").and_then(|x| x.as_array()).map(|a| a.iter().any(|v| v == "italic")).unwrap_or(false);
        let mut styles: Vec<String> = weights.iter().map(|w| w.to_string()).collect();
        if italic {
            styles.extend(weights.iter().map(|w| format!("{w}i")));
        }
        families.push(CatalogFamily {
            id: format!("fs:{}", s(r, "id")),
            family: s(r, "family"),
            source: "fontsource".into(),
            category: map_fontsource_cat(&s(r, "category")).into(),
            designer: String::new(),
            style_count: styles.len() as u32,
            styles,
            variable: r.get("variable").and_then(|x| x.as_bool()).unwrap_or(false),
            axes: vec![],
            subsets: r.get("subsets").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|d| d.as_str().map(String::from)).collect()).unwrap_or_default(),
            license: s(r, "license"),
            popularity: 99999,
            date_added: String::new(),
            last_modified: s(r, "lastModified"),
            fs_id: Some(s(r, "id")),
            sq_url: None,
        });
    }

    match sq {
        Ok(Value::Array(rows)) => {
            for r in rows {
                let count = s(&r, "family_count").parse::<u32>().unwrap_or(1);
                families.push(CatalogFamily {
                    id: format!("sq:{}", s(&r, "family_urlname")),
                    family: s(&r, "family_name"),
                    source: "fontsquirrel".into(),
                    category: map_squirrel_cat(&s(&r, "classification")).into(),
                    designer: s(&r, "foundry_name"),
                    styles: vec![],
                    style_count: count,
                    variable: false,
                    axes: vec![],
                    subsets: vec!["latin".into()],
                    license: "Free for commercial use".into(),
                    popularity: 99999,
                    date_added: String::new(),
                    last_modified: String::new(),
                    fs_id: None,
                    sq_url: Some(s(&r, "family_urlname")),
                });
            }
        }
        Ok(_) => {}
        Err(e) => errors.push(format!("Font Squirrel: {e}")),
    }

    Catalog { fetched_at: now(), families, errors }
}

pub async fn load_catalog(cache_file: &Path, force: bool) -> Result<Catalog, String> {
    let cached: Option<Catalog> = fs::read_to_string(cache_file).ok().and_then(|t| serde_json::from_str(&t).ok());
    if let Some(c) = &cached {
        if !force && now().saturating_sub(c.fetched_at) < 3 * 24 * 3600 && !c.families.is_empty() {
            return Ok(cached.unwrap());
        }
    }
    let fresh = fetch_catalog().await;
    if fresh.families.is_empty() {
        // Offline: fall back to whatever we had.
        return cached.ok_or_else(|| format!("Could not load the font library. {}", fresh.errors.join("; ")));
    }
    if let Ok(t) = serde_json::to_string(&fresh) {
        let _ = fs::write(cache_file, t);
    }
    Ok(fresh)
}

// ------------------------------------------------------------------ downloads

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub job_id: String,
    pub family: String,
    /// "downloading" | "installing" | "done" | "error"
    pub stage: String,
    pub done: u32,
    pub total: u32,
    pub message: String,
}

pub fn emit(app: &AppHandle, p: Progress) {
    let _ = app.emit("install-progress", p);
}

pub async fn download(url: &str, dest: &Path) -> Result<(), String> {
    let resp = client().get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {url}", resp.status()));
    }
    if let Some(p) = dest.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let mut out = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        out.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
    }
    fs::write(dest, out).map_err(|e| e.to_string())
}

fn style_suffix(key: &str) -> String {
    let italic = key.ends_with('i');
    let w = key.trim_end_matches('i').parse::<u32>().unwrap_or(400);
    let name = match w {
        100 => "Thin",
        200 => "ExtraLight",
        300 => "Light",
        500 => "Medium",
        600 => "SemiBold",
        700 => "Bold",
        800 => "ExtraBold",
        900 => "Black",
        _ => "Regular",
    };
    match (italic, name) {
        (true, "Regular") => "Italic".into(),
        (true, n) => format!("{n}Italic"),
        (false, n) => n.into(),
    }
}

/// Downloads the font files of a family into `dir`; returns local paths.
pub async fn fetch_family_files(
    app: &AppHandle,
    fam: &CatalogFamily,
    styles: &Option<Vec<String>>,
    prefer_static: bool,
    dir: &Path,
    job_id: &str,
) -> Result<Vec<PathBuf>, String> {
    let report = |done: u32, total: u32| {
        emit(app, Progress { job_id: job_id.into(), family: fam.family.clone(), stage: "downloading".into(), done, total, message: String::new() });
    };
    match fam.source.as_str() {
        "google" => {
            let url = format!("https://fonts.google.com/download/list?family={}", fam.family.replace(' ', "%20"));
            let v = get_json(&url).await?;
            let refs: Vec<(String, String)> = v["manifest"]["fileRefs"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|r| (s(r, "filename"), s(r, "url")))
                .filter(|(f, _)| fonts::is_font_name(f))
                .collect();
            let has_static = refs.iter().any(|(f, _)| f.starts_with("static/"));
            let mut chosen: Vec<(String, String)> = refs
                .iter()
                .filter(|(f, _)| if has_static && prefer_static { f.starts_with("static/") } else { !f.starts_with("static/") })
                .cloned()
                .collect();
            if let Some(sel) = styles {
                let is_static_set = chosen.iter().all(|(f, _)| f.starts_with("static/")) || !has_static;
                let only_variable = chosen.iter().any(|(f, _)| f.contains('['));
                if is_static_set && !only_variable {
                    let wanted: Vec<String> = sel.iter().map(|k| format!("-{}", style_suffix(k)).to_lowercase()).collect();
                    chosen.retain(|(f, _)| {
                        let stem = Path::new(f).file_stem().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
                        wanted.iter().any(|w| stem.ends_with(w))
                    });
                }
            }
            if chosen.is_empty() {
                return Err("No matching font files".into());
            }
            let total = chosen.len() as u32;
            let mut out = Vec::new();
            for (i, (fname, url)) in chosen.iter().enumerate() {
                report(i as u32, total);
                let base = Path::new(fname).file_name().unwrap().to_owned();
                let dest = dir.join(base);
                download(url, &dest).await?;
                out.push(dest);
            }
            report(total, total);
            Ok(out)
        }
        "fontsource" => {
            let id = fam.fs_id.clone().ok_or("missing id")?;
            report(0, 1);
            let zip_path = dir.join(format!("{id}.zip"));
            download(&format!("https://r2.fontsource.org/fonts/{id}@latest/download.zip"), &zip_path).await?;
            report(1, 1);
            let mut files = archive::font_paths_in_zip_to(&zip_path, &dir.join("x"))?;
            // Fontsource ships one file per script subset; keep one subset so names don't clash.
            let latin: Vec<PathBuf> = files.iter().filter(|p| p.to_string_lossy().contains("-latin-") && !p.to_string_lossy().contains("-latin-ext-")).cloned().collect();
            if !latin.is_empty() {
                files = latin;
            }
            if let Some(sel) = styles {
                let wanted: Vec<String> = sel.iter().map(|k| {
                    let it = if k.ends_with('i') { "italic" } else { "normal" };
                    format!("-{}-{it}", k.trim_end_matches('i'))
                }).collect();
                files.retain(|p| wanted.iter().any(|w| p.to_string_lossy().contains(w.as_str())));
            }
            Ok(files)
        }
        "fontsquirrel" => {
            let url_name = fam.sq_url.clone().ok_or("missing id")?;
            report(0, 1);
            let files = squirrel_files(&url_name, dir).await?;
            report(1, 1);
            Ok(files)
        }
        _ => Err("Unknown source".into()),
    }
}

/// Downloads (or reuses) a Font Squirrel family zip and returns its font files.
pub async fn squirrel_files(url_name: &str, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let zip_path = dir.join(format!("{url_name}.zip"));
    if !zip_path.exists() {
        download(&format!("https://www.fontsquirrel.com/fonts/download/{url_name}"), &zip_path).await?;
    }
    let out_dir = dir.join(format!("{url_name}-files"));
    let mut files: Vec<PathBuf> = if out_dir.exists() {
        walk_fonts(&out_dir)
    } else {
        archive::font_paths_in_zip_to(&zip_path, &out_dir)?
    };
    // Some families ship both .otf and .ttf of every style; keep one of each face.
    let mut seen = std::collections::HashSet::new();
    files.sort_by_key(|p| !p.to_string_lossy().to_lowercase().ends_with(".otf"));
    files.retain(|p| {
        let faces = fonts::parse_file(p);
        faces.first().map(|f| seen.insert(fonts::face_key(&f.family, &f.style))).unwrap_or(false)
    });
    if files.is_empty() {
        return Err("This download has no font files".into());
    }
    Ok(files)
}

fn walk_fonts(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        if let Ok(rd) = fs::read_dir(&d) {
            for e in rd.filter_map(|e| e.ok()) {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if fonts::is_font_name(&p.to_string_lossy()) {
                    out.push(p);
                }
            }
        }
    }
    out
}
