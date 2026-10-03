//! Current-user font discovery/installation shared by desktop ingress and Agent tools.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_FONT_BYTES: usize = 32 * 1024 * 1024;
#[derive(Debug, thiserror::Error)]
pub enum FontError {
    #[error("FONT_INVALID: choose a valid TTF, OTF or TTC font (up to 32 MiB)")]
    Invalid,
    #[error("FONT_IO_FAILED: could not access the current user's font directory")]
    Io,
    #[error("FONT_REGISTRATION_FAILED: the system did not activate this font")]
    Registration,
    #[error("FONT_DESTINATION_CONFLICT: existing files are never replaced")]
    Conflict,
}
#[derive(Clone, Debug, Serialize)]
pub struct FontFamily {
    pub family: String,
    pub monospace: bool,
}
#[derive(Debug, Serialize)]
pub struct FontCatalog {
    pub families: Vec<FontFamily>,
    pub install_directory: String,
}
#[derive(Debug, Serialize)]
pub struct FontInfo {
    pub families: Vec<FontFamily>,
    pub sha256: String,
    pub bytes: usize,
    pub extension: String,
}
#[derive(Debug, Serialize)]
pub struct FontInstallation {
    pub kind: &'static str,
    pub success: bool,
    pub installed: bool,
    pub already_installed: bool,
    pub path: String,
    pub font: FontInfo,
    pub registration: &'static str,
    pub verification_scope: &'static str,
    pub verification_eligible: bool,
}
fn families(db: &fontdb::Database) -> Vec<FontFamily> {
    let mut values = BTreeMap::<String, bool>::new();
    for face in db.faces() {
        for (name, _) in &face.families {
            if !name.starts_with('.') && name.len() <= 256 && !name.chars().any(char::is_control) {
                values
                    .entry(name.clone())
                    .and_modify(|mono| *mono |= face.monospaced)
                    .or_insert(face.monospaced);
            }
        }
    }
    values
        .into_iter()
        .map(|(family, monospace)| FontFamily { family, monospace })
        .collect()
}
pub fn user_directory() -> Result<PathBuf, FontError> {
    #[cfg(target_os = "macos")]
    let path = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Fonts"));
    #[cfg(windows)]
    let path =
        std::env::var_os("LOCALAPPDATA").map(|h| PathBuf::from(h).join("Microsoft/Windows/Fonts"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let path = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .map(|h| h.join("fonts"));
    path.filter(|p| p.is_absolute()).ok_or(FontError::Io)
}
pub fn list() -> Result<FontCatalog, FontError> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let directory = user_directory()?;
    // Explicit user scan also handles per-user Windows fonts on older fontdb versions.
    if directory.is_dir() {
        db.load_fonts_dir(&directory);
    }
    let discovered = families(&db);
    #[cfg(target_os = "macos")]
    let discovered = available_mac_families(&discovered);
    Ok(FontCatalog {
        families: discovered,
        install_directory: directory.to_string_lossy().into(),
    })
}
pub fn inspect(bytes: &[u8]) -> Result<FontInfo, FontError> {
    if bytes.len() < 12 || bytes.len() > MAX_FONT_BYTES {
        return Err(FontError::Invalid);
    }
    let extension = match &bytes[..4] {
        b"\0\x01\0\0" | b"true" => "ttf",
        b"OTTO" => "otf",
        b"ttcf" => "ttc",
        _ => return Err(FontError::Invalid),
    };
    let mut db = fontdb::Database::new();
    db.load_font_data(bytes.to_vec());
    let families = families(&db);
    if families.is_empty() || db.faces().count() > 128 {
        return Err(FontError::Invalid);
    }
    Ok(FontInfo {
        families,
        sha256: format!("{:x}", Sha256::digest(bytes)),
        bytes: bytes.len(),
        extension: extension.into(),
    })
}
pub fn read_file(path: &Path) -> Result<Vec<u8>, FontError> {
    let meta = fs::symlink_metadata(path).map_err(|_| FontError::Io)?;
    if !meta.is_file() || meta.len() > MAX_FONT_BYTES as u64 {
        return Err(FontError::Invalid);
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| FontError::Io)?
        .take(MAX_FONT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| FontError::Io)?;
    inspect(&bytes)?;
    Ok(bytes)
}
pub fn import_file(path: &Path) -> Result<FontInstallation, FontError> {
    install(&read_file(path)?)
}
pub fn install(bytes: &[u8]) -> Result<FontInstallation, FontError> {
    install_into(bytes, &user_directory()?, register)
}
fn install_into(
    bytes: &[u8],
    directory: &Path,
    register: impl FnOnce(&Path) -> Result<(), FontError>,
) -> Result<FontInstallation, FontError> {
    let font = inspect(bytes)?;
    fs::create_dir_all(directory).map_err(|_| FontError::Io)?;
    // Reject redirected installation roots; publication never accepts a model/user destination.
    if fs::symlink_metadata(directory)
        .map_err(|_| FontError::Io)?
        .file_type()
        .is_symlink()
    {
        return Err(FontError::Conflict);
    }
    let target = directory.join(format!("Fielora-{}.{}", font.sha256, font.extension));
    let mut installed = false;
    if target.try_exists().map_err(|_| FontError::Io)? {
        if fs::symlink_metadata(&target)
            .map_err(|_| FontError::Io)?
            .file_type()
            .is_symlink()
            || read_file(&target)? != bytes
        {
            return Err(FontError::Conflict);
        }
    } else {
        // A complete file is linked into place without replacing any concurrent publication.
        let staged = directory.join(format!(".fielora-font-{}", uuid::Uuid::now_v7()));
        let publish = (|| {
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staged)
                .map_err(|_| FontError::Io)?;
            out.write_all(bytes).map_err(|_| FontError::Io)?;
            out.sync_all().map_err(|_| FontError::Io)?;
            drop(out);
            fs::hard_link(&staged, &target).map_err(|_| FontError::Conflict)?;
            Ok(())
        })();
        let _ = fs::remove_file(&staged);
        publish?;
        installed = true;
    }
    if let Err(error) = register(&target) {
        if installed {
            let _ = fs::remove_file(&target);
        }
        return Err(error);
    }
    if read_file(&target)? != bytes {
        return Err(FontError::Conflict);
    }
    Ok(FontInstallation {
        kind: "FONT_INSTALLATION_V1",
        success: true,
        installed: true,
        already_installed: !installed,
        path: target.to_string_lossy().into(),
        font,
        registration: "CURRENT_USER",
        verification_scope: "INSTALLED_FONT_BYTES_AND_NATIVE_REGISTRATION",
        verification_eligible: false,
    })
}
#[cfg(target_os = "macos")]
fn available_mac_families(discovered: &[FontFamily]) -> Vec<FontFamily> {
    use core_foundation::{
        array::{CFArray, CFArrayRef},
        base::TCFType,
        string::CFString,
    };
    #[link(name = "CoreText", kind = "framework")]
    unsafe extern "C" {
        fn CTFontManagerCopyAvailableFontFamilyNames() -> CFArrayRef;
    }
    let raw = unsafe { CTFontManagerCopyAvailableFontFamilyNames() };
    if raw.is_null() {
        return Vec::new();
    }
    let names = unsafe { CFArray::<CFString>::wrap_under_create_rule(raw) };
    let mut values = names
        .iter()
        .map(|name| name.to_string())
        .filter(|name| !name.starts_with('.'))
        .map(|family| {
            let monospace = discovered
                .iter()
                .any(|f| f.family.eq_ignore_ascii_case(&family) && f.monospace);
            FontFamily { family, monospace }
        })
        .collect::<Vec<_>>();
    values.sort_by_key(|a| a.family.to_lowercase());
    values.dedup_by(|a, b| a.family == b.family);
    values
}

#[cfg(target_os = "macos")]
fn register(path: &Path) -> Result<(), FontError> {
    use core_foundation::{
        base::TCFType,
        error::{CFError, CFErrorRef},
        url::{CFURL, CFURLRef},
    };
    #[link(name = "CoreText", kind = "framework")]
    unsafe extern "C" {
        fn CTFontManagerRegisterFontsForURL(
            url: CFURLRef,
            scope: u32,
            error: *mut CFErrorRef,
        ) -> bool;
    }
    let url = CFURL::from_path(path, false).ok_or(FontError::Io)?;
    let mut error = std::ptr::null_mut();
    let success =
        unsafe { CTFontManagerRegisterFontsForURL(url.as_concrete_TypeRef(), 2, &mut error) };
    let code = if error.is_null() {
        0
    } else {
        unsafe { CFError::wrap_under_create_rule(error) }.code()
    };
    // 105 = already registered (including OS directory watcher registration).
    if success || code == 105 {
        Ok(())
    } else {
        Err(FontError::Registration)
    }
}
#[cfg(windows)]
fn register(path: &Path) -> Result<(), FontError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Graphics::Gdi::{AddFontResourceW, RemoveFontResourceW},
        System::Registry::*,
        UI::WindowsAndMessaging::*,
    };
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let key_name = wide(std::ffi::OsStr::new(
        "Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    ));
    let name = wide(path.file_name().ok_or(FontError::Io)?);
    let value = wide(path.as_os_str());
    let mut key = std::ptr::null_mut();
    unsafe {
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_name.as_ptr(),
            0,
            std::ptr::null(),
            0,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        ) != 0
        {
            return Err(FontError::Registration);
        }
        if AddFontResourceW(value.as_ptr()) == 0 {
            RegCloseKey(key);
            return Err(FontError::Registration);
        }
        let status = RegSetValueExW(
            key,
            name.as_ptr(),
            0,
            REG_SZ,
            value.as_ptr().cast(),
            (value.len() * 2) as u32,
        );
        RegCloseKey(key);
        if status != 0 {
            RemoveFontResourceW(value.as_ptr());
            return Err(FontError::Registration);
        }
        SendNotifyMessageW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0);
    }
    Ok(())
}
#[cfg(all(unix, not(target_os = "macos")))]
fn register(path: &Path) -> Result<(), FontError> {
    let result = std::process::Command::new("/usr/bin/fc-cache")
        .arg(path.parent().ok_or(FontError::Io)?)
        .status()
        .map_err(|_| FontError::Registration)?;
    if result.success() {
        Ok(())
    } else {
        Err(FontError::Registration)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const FONT: &[u8] = include_bytes!("../../../tests/fixtures/fonts/FieloraFontFixture.ttf");
    #[test]
    fn installs_exact_bytes_without_replacement_and_rolls_back_registration_failure() {
        let root = std::env::temp_dir().join(format!("font-unit-{}", uuid::Uuid::now_v7()));
        let first = install_into(FONT, &root, |_| Ok(())).unwrap();
        assert_eq!(first.font.families[0].family, "Fielora Font Fixture");
        assert!(!first.already_installed);
        assert_eq!(fs::read(&first.path).unwrap(), FONT);
        assert!(
            install_into(FONT, &root, |_| Ok(()))
                .unwrap()
                .already_installed
        );
        fs::write(&first.path, b"existing content").unwrap();
        assert!(install_into(FONT, &root, |_| Ok(())).is_err());
        assert_eq!(fs::read(&first.path).unwrap(), b"existing content");
        fs::remove_file(&first.path).unwrap();
        assert!(install_into(FONT, &root, |_| Err(FontError::Registration)).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_redirected_installation() {
        let root = std::env::temp_dir().join(format!("font-link-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(root.join("outside")).unwrap();
        std::os::unix::fs::symlink(root.join("outside"), root.join("fonts")).unwrap();
        assert!(matches!(
            install_into(FONT, &root.join("fonts"), |_| Ok(())),
            Err(FontError::Conflict)
        ));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_fonts_are_rejected_before_publication() {
        for bytes in [
            b"not a font".as_slice(),
            b"\0\x01\0\0garbage bytes".as_slice(),
            &vec![0; MAX_FONT_BYTES + 1],
        ] {
            assert!(inspect(bytes).is_err());
        }
    }
}
