//! Replace configuration only after its replacement and recovery copy are durable.
use std::{fs::{self, OpenOptions}, io::{self, Write}, path::Path, sync::atomic::{AtomicU64, Ordering}};

pub static CONFIG_WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temporary = path.with_extension(format!("tmp-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

/// Caller holds CONFIG_WRITE_LOCK across validation and replacement.
pub fn write_config(path: &Path, bytes: &[u8]) -> io::Result<()> {
    match fs::read(path) {
        Ok(previous) => {
            serde_json::from_slice::<serde_json::Value>(&previous)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, format!("Repair the existing configuration before saving: {error}")))?;
            atomic_write(&path.with_extension("json.bak"), &previous)?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    atomic_write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_keeps_backup_and_refuses_corrupt_original() {
        let dir = std::env::temp_dir().join(format!("muxly-config-test-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("settings.json");
        write_config(&path, b"{}").unwrap();
        write_config(&path, b"{\"new\":true}").unwrap();
        assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), b"{}");
        assert_eq!(fs::read(&path).unwrap(), b"{\"new\":true}");
        fs::write(&path, b"broken").unwrap();
        assert!(write_config(&path, b"{}").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), b"{}");
        fs::write(&path, b"{}").unwrap();
        fs::remove_file(path.with_extension("json.bak")).unwrap();
        fs::create_dir(path.with_extension("json.bak")).unwrap();
        assert!(write_config(&path, b"{\"new\":false}").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{}");
        fs::remove_dir_all(dir).unwrap();
    }
}
