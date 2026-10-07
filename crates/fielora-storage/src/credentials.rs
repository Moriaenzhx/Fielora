//! Local credential persistence through the existing sole SQLite owner.
use crate::{StorageHandle, request_task, storage_domain};
use fielora_platform::{CredentialError, CredentialRef, CredentialStore, SecretBytes};
use rusqlite::{OptionalExtension, params};
use std::sync::{Arc, Mutex};

pub struct LocalCredentialStore {
    storage: StorageHandle,
    legacy: Arc<dyn CredentialStore>,
    gate: Mutex<()>,
}

impl LocalCredentialStore {
    /// The legacy adapter must never open an authentication dialog.
    pub fn new(storage: StorageHandle, legacy: Arc<dyn CredentialStore>) -> Self {
        Self {
            storage,
            legacy,
            gate: Mutex::new(()),
        }
    }

    fn stored(&self, target: &str) -> Result<Option<Option<SecretBytes>>, CredentialError> {
        let target = target.to_owned();
        request_task(&self.storage.sender, move |connection| {
            connection
                .query_row(
                    "SELECT secret FROM local_credentials WHERE target=?1",
                    [target],
                    |row| Ok(row.get::<_, Option<Vec<u8>>>(0)?.map(SecretBytes::new)),
                )
                .optional()
                .map_err(storage_domain)
        })
        .map_err(|_| CredentialError::Platform)
    }

    fn save(&self, target: &str, secret: Option<SecretBytes>) -> Result<(), CredentialError> {
        let target = target.to_owned();
        if target.is_empty() || target.len() > 512 {
            return Err(CredentialError::InvalidReference);
        }
        if secret
            .as_ref()
            .is_some_and(|s| s.expose().is_empty() || s.expose().len() > 2048)
        {
            return Err(CredentialError::InvalidSize);
        }
        request_task(&self.storage.sender, move |connection| {
            connection.execute("INSERT INTO local_credentials(target,secret) VALUES(?1,?2) ON CONFLICT(target) DO UPDATE SET secret=excluded.secret",
                params![target, secret.as_ref().map(SecretBytes::expose)]).map_err(storage_domain)?;
            Ok(())
        }).map_err(|_| CredentialError::Platform)
    }
}

impl CredentialStore for LocalCredentialStore {
    fn store(&self, target: &str, secret: SecretBytes) -> Result<(), CredentialError> {
        let _guard = self.gate.lock().map_err(|_| CredentialError::Platform)?;
        self.save(target, Some(secret))
    }

    fn read(&self, target: &str) -> Result<SecretBytes, CredentialError> {
        let _guard = self.gate.lock().map_err(|_| CredentialError::Platform)?;
        if let Some(value) = self.stored(target)? {
            return value.ok_or(CredentialError::NotFound);
        }
        // Only compatibility reads use the OS store, without user interaction.
        let value = self.legacy.read(target)?;
        self.save(target, Some(SecretBytes::new(value.expose().to_vec())))?;
        Ok(value)
    }

    fn delete(&self, target: &str) -> Result<(), CredentialError> {
        let _guard = self.gate.lock().map_err(|_| CredentialError::Platform)?;
        self.save(target, None)
    }

    fn exists(&self, target: &str) -> bool {
        let Ok(_guard) = self.gate.lock() else {
            return false;
        };
        let target_owned = target.to_owned();
        // Existence checks never load key bytes or migrate legacy entries.
        let present = request_task(&self.storage.sender, move |connection| {
            connection
                .query_row(
                    "SELECT secret IS NOT NULL FROM local_credentials WHERE target=?1",
                    [target_owned],
                    |row| row.get::<_, bool>(0),
                )
                .optional()
                .map_err(storage_domain)
        });
        match present {
            Ok(Some(present)) => present,
            Ok(None) => self.legacy.exists(target),
            Err(_) => false,
        }
    }

    fn static_exists(&self, credential_ref: &CredentialRef) -> bool {
        self.exists(&credential_ref.target_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StorageWorker, create_portable_snapshot, open_connection};
    use fielora_platform::{DeviceIdentity, PlatformPaths};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[derive(Default)]
    struct Legacy {
        reads: AtomicUsize,
        locked: AtomicBool,
    }
    impl CredentialStore for Legacy {
        fn store(&self, _: &str, _: SecretBytes) -> Result<(), CredentialError> {
            panic!("legacy writes forbidden")
        }
        fn delete(&self, _: &str) -> Result<(), CredentialError> {
            panic!("legacy deletes forbidden")
        }
        fn read(&self, _: &str) -> Result<SecretBytes, CredentialError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.locked.load(Ordering::SeqCst) {
                Err(CredentialError::InteractionRequired)
            } else {
                Ok(SecretBytes::new(b"synthetic-legacy-secret-unique".to_vec()))
            }
        }
        fn exists(&self, _: &str) -> bool {
            true
        }
        fn static_exists(&self, _: &CredentialRef) -> bool {
            true
        }
    }
    fn setup() -> (PlatformPaths, DeviceIdentity) {
        let paths = PlatformPaths::from_root(std::env::temp_dir().join(format!(
            "fielora-local-credentials-{}",
            uuid::Uuid::now_v7()
        )))
        .unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        (paths, device)
    }

    #[test]
    fn migration_restart_override_delete_and_export_never_resurrect_or_expose_secrets() {
        let (paths, device) = setup();
        let worker = StorageWorker::start(&paths.database, device.clone(), 1).unwrap();
        worker.shutdown();
        // Simulate the exact predecessor schema, keeping its migration registry.
        let db = open_connection(&paths.database).unwrap();
        db.execute_batch(
            "DROP TABLE local_credentials; DELETE FROM schema_migrations WHERE version=19;",
        )
        .unwrap();
        drop(db);
        let legacy = Arc::new(Legacy::default());
        let worker = StorageWorker::start(&paths.database, device.clone(), 2).unwrap();
        let store = LocalCredentialStore::new(worker.handle(), legacy.clone());
        assert!(store.exists("legacy"));
        assert_eq!(legacy.reads.load(Ordering::SeqCst), 0);
        assert_eq!(
            store.read("legacy").unwrap().expose(),
            b"synthetic-legacy-secret-unique"
        );
        assert_eq!(legacy.reads.load(Ordering::SeqCst), 1);
        store
            .store(
                "new",
                SecretBytes::new(b"synthetic-database-key-unique".to_vec()),
            )
            .unwrap();
        store
            .store(
                "legacy",
                SecretBytes::new(b"synthetic-replacement-key-unique".to_vec()),
            )
            .unwrap();
        assert!(store.store("new", SecretBytes::new(vec![])).is_err());
        assert!(store.store("new", SecretBytes::new(vec![1; 2049])).is_err());
        store.delete("deleted").unwrap();
        drop(store);
        worker.shutdown();
        legacy.locked.store(true, Ordering::SeqCst);
        let worker = StorageWorker::start(&paths.database, device, 3).unwrap();
        let store = LocalCredentialStore::new(worker.handle(), legacy.clone());
        assert_eq!(
            store.read("new").unwrap().expose(),
            b"synthetic-database-key-unique"
        );
        assert_eq!(
            store.read("legacy").unwrap().expose(),
            b"synthetic-replacement-key-unique"
        );
        assert!(!store.exists("deleted"));
        assert!(matches!(
            store.read("deleted"),
            Err(CredentialError::NotFound)
        ));
        assert_eq!(legacy.reads.load(Ordering::SeqCst), 1);
        let public = serde_json::to_string(
            &store
                .storage
                .list_provider_configs()
                .unwrap()
                .into_iter()
                .map(|p| p.view)
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(!public.contains("synthetic-"));
        drop(store);
        worker.shutdown();
        let snapshot = paths.base_dir.join("export.db");
        create_portable_snapshot(&paths.database, &snapshot).unwrap();
        let exported = open_connection(&snapshot).unwrap();
        assert_eq!(
            exported
                .query_row("SELECT count(*) FROM local_credentials", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(exported);
        let bytes = std::fs::read(&snapshot).unwrap();
        for secret in [
            b"synthetic-database-key-unique".as_slice(),
            b"synthetic-replacement-key-unique",
            b"synthetic-legacy-secret-unique",
        ] {
            assert!(!bytes.windows(secret.len()).any(|chunk| chunk == secret));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&paths.database)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(paths.base_dir).unwrap();
    }

    #[test]
    fn locked_legacy_read_preserves_entry_and_explicit_save_repairs_it_without_os_writes() {
        let (paths, device) = setup();
        let worker = StorageWorker::start(&paths.database, device, 1).unwrap();
        let legacy = Arc::new(Legacy::default());
        legacy.locked.store(true, Ordering::SeqCst);
        let store = LocalCredentialStore::new(worker.handle(), legacy.clone());
        assert!(matches!(
            store.read("old"),
            Err(CredentialError::InteractionRequired)
        ));
        assert!(store.stored("old").unwrap().is_none());
        store
            .store("old", SecretBytes::new(b"new-key".to_vec()))
            .unwrap();
        assert_eq!(store.read("old").unwrap().expose(), b"new-key");
        assert_eq!(legacy.reads.load(Ordering::SeqCst), 1);
        store.delete("old").unwrap();
        assert!(matches!(store.read("old"), Err(CredentialError::NotFound)));
        drop(store);
        worker.shutdown();
        std::fs::remove_dir_all(paths.base_dir).unwrap();
    }
}
