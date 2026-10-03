//! Non-secret endpoint/model settings. Validation is invalidated by settings or credential changes.
use super::*;

#[derive(Debug, Clone, Default)]
pub struct StoredModelRuntime {
    pub settings: ModelRuntimeSettings,
    pub revision: u64,
    pub validation: Option<ModelCompatibilityReport>,
}

fn read(
    connection: &Connection,
    id: &ProviderConfigId,
    key: &str,
    model: &str,
    provider_revision: u64,
) -> Result<StoredModelRuntime, DomainError> {
    let row: Option<(String,u64,Option<String>)> = connection.query_row(
        "SELECT settings_json,revision,validation_json FROM model_runtime_settings WHERE provider_config_id=?1 AND endpoint_key=?2 AND model_id=?3",
        params![id.0,key,model], |r| Ok((r.get(0)?,revision_from_row(r,1)?,r.get(2)?))
    ).optional().map_err(storage_domain)?;
    let Some((settings, revision, validation)) = row else {
        return Ok(StoredModelRuntime::default());
    };
    let settings = serde_json::from_str(&settings)
        .map_err(|_| DomainError::Validation("MODEL_SETTINGS_INVALID".into()))?;
    let validation: Option<ModelCompatibilityReport> = validation
        .map(|v| serde_json::from_str(&v))
        .transpose()
        .map_err(|_| DomainError::Validation("MODEL_SETTINGS_INVALID".into()))?;
    Ok(StoredModelRuntime {
        settings,
        revision,
        validation: validation.filter(|v| v.provider_revision == provider_revision),
    })
}

impl StorageHandle {
    pub fn model_runtime(
        &self,
        id: ProviderConfigId,
        key: String,
        model: String,
    ) -> Result<StoredModelRuntime, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let provider = get_provider_record(connection, &owner, &id)?;
            read(connection, &id, &key, &model, provider.view.revision)
        })
    }
    pub fn save_model_runtime(
        &self,
        id: ProviderConfigId,
        key: String,
        model: String,
        provider_revision: u64,
        expected_revision: u64,
        settings: ModelRuntimeSettings,
    ) -> Result<(), DomainError> {
        if !(256..=16384).contains(&settings.max_output_tokens) {
            return Err(DomainError::Validation(
                "MODEL_CONFIGURATION_UNSUPPORTED".into(),
            ));
        }
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let tx = connection.transaction().map_err(storage_domain)?;
            let provider = get_provider_record(&tx, &owner, &id)?;
            if provider.view.revision != provider_revision
                || read(&tx, &id, &key, &model, provider_revision)?.revision != expected_revision
            {
                return Err(DomainError::RevisionConflict);
            }
            tx.execute("INSERT INTO model_runtime_settings(provider_config_id,endpoint_key,model_id,settings_json,revision) VALUES(?1,?2,?3,?4,1) ON CONFLICT(provider_config_id,endpoint_key,model_id) DO UPDATE SET settings_json=excluded.settings_json,revision=revision+1,validation_json=NULL",params![id.0,key,model,serde_json::to_string(&settings).unwrap()]).map_err(storage_domain)?;
            tx.commit().map_err(storage_domain)
        })
    }
    pub fn save_model_validation(
        &self,
        id: ProviderConfigId,
        key: String,
        model: String,
        expected_revision: u64,
        report: ModelCompatibilityReport,
    ) -> Result<(), DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let tx = connection.transaction().map_err(storage_domain)?;
            let provider = get_provider_record(&tx, &owner, &id)?;
            let current = read(&tx, &id, &key, &model, provider.view.revision)?;
            if provider.view.revision != report.provider_revision
                || current.revision != expected_revision
                || current.settings != report.settings
            {
                return Err(DomainError::RevisionConflict);
            }
            tx.execute("INSERT INTO model_runtime_settings(provider_config_id,endpoint_key,model_id,settings_json,revision,validation_json) VALUES(?1,?2,?3,?4,1,?5) ON CONFLICT(provider_config_id,endpoint_key,model_id) DO UPDATE SET validation_json=excluded.validation_json",params![id.0,key,model,serde_json::to_string(&report.settings).unwrap(),serde_json::to_string(&report).unwrap()]).map_err(storage_domain)?;
            tx.commit().map_err(storage_domain)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_platform::PlatformPaths;
    #[test]
    fn schema_17_upgrade_and_custom_mode_preserve_identity_and_credential_reference() {
        let root = std::env::temp_dir().join(format!("fielora-custom-mode-{}", Uuid::now_v7()));
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let worker = StorageWorker::start(&paths.database, device.clone(), 1).unwrap();
        let original = worker
            .handle()
            .create_provider_config(
                CreateProviderConfigRequest {
                    model_optimization: None,
                    provider_kind: ProviderKind::OpenaiCompatible,
                    display_name: "Existing".into(),
                    base_url: Some("https://api.minimaxi.com/v1".into()),
                    default_model: "MiniMax-M3".into(),
                    custom_endpoint_acknowledged: true,
                },
                2,
            )
            .unwrap();
        worker.shutdown();
        let db = open_connection(&paths.database).unwrap();
        db.execute_batch("ALTER TABLE provider_configs DROP COLUMN model_optimization; DELETE FROM schema_migrations WHERE version=18;").unwrap();
        drop(db);
        let worker = StorageWorker::start(&paths.database, device.clone(), 3).unwrap();
        let storage = worker.handle();
        let migrated = storage
            .get_provider_config(original.view.id.clone())
            .unwrap();
        assert_eq!(migrated.view, original.view);
        assert_eq!(migrated.credential_ref, original.credential_ref);
        let request = UpdateProviderConfigRequest {
            model_optimization: Some(false),
            provider_kind: None,
            provider_config_id: original.view.id.clone(),
            expected_revision: original.view.revision,
            display_name: "Custom".into(),
            base_url: original.view.base_url.clone(),
            default_model: original.view.default_model.clone(),
            custom_endpoint_acknowledged: true,
        };
        let updated = storage.update_provider_config(request.clone(), 4).unwrap();
        assert!(!updated.view.model_optimization);
        assert_eq!(updated.credential_ref, original.credential_ref);
        assert!(matches!(
            storage.update_provider_config(request, 5),
            Err(DomainError::RevisionConflict)
        ));
        worker.shutdown();
        let worker = StorageWorker::start(&paths.database, device, 6).unwrap();
        assert!(
            !worker
                .handle()
                .get_provider_config(original.view.id)
                .unwrap()
                .view
                .model_optimization
        );
        worker.shutdown();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn settings_evidence_and_revision_are_scoped_and_survive_schema_16_upgrade() {
        let root = std::env::temp_dir().join(format!("fielora-model-runtime-{}", Uuid::now_v7()));
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let worker = StorageWorker::start(&paths.database, device.clone(), 1).unwrap();
        let storage = worker.handle();
        let provider = storage
            .create_provider_config(
                CreateProviderConfigRequest {
                    model_optimization: None,
                    provider_kind: ProviderKind::OpenaiCompatible,
                    display_name: "model settings fixture".into(),
                    base_url: Some("https://example.com/v1".into()),
                    default_model: "model".into(),
                    custom_endpoint_acknowledged: true,
                },
                2,
            )
            .unwrap();
        let id = provider.view.id.clone();
        worker.shutdown();
        // Reverse only the new additive table in this disposable fixture to reproduce schema 16.
        let mut db = open_connection(&paths.database).unwrap();
        db.execute_batch(
            "ALTER TABLE provider_configs DROP COLUMN model_optimization; DROP TABLE model_runtime_settings; DELETE FROM schema_migrations WHERE version>=17;",
        )
        .unwrap();
        assert_eq!(
            db.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            16
        );
        apply_migrations(&mut db, 3).unwrap();
        apply_migrations(&mut db, 4).unwrap();
        validate_schema(&db).unwrap();
        drop(db);
        let worker = StorageWorker::start(&paths.database, device.clone(), 5).unwrap();
        let storage = worker.handle();
        assert_eq!(
            storage
                .get_provider_config(id.clone())
                .unwrap()
                .view
                .default_model,
            "model"
        );
        let key = "OpenaiCompatible:https://example.com/v1".to_owned();
        let model = "model".to_owned();
        let settings = ModelRuntimeSettings {
            reasoning: ReasoningMode::ProviderDefault,
            max_output_tokens: 2048,
        };
        storage
            .save_model_runtime(
                id.clone(),
                key.clone(),
                model.clone(),
                1,
                0,
                settings.clone(),
            )
            .unwrap();
        assert!(matches!(
            storage.save_model_runtime(
                id.clone(),
                key.clone(),
                model.clone(),
                1,
                0,
                settings.clone()
            ),
            Err(DomainError::RevisionConflict)
        ));
        let report = ModelCompatibilityReport {
            profile_id: "generic-v1".into(),
            checks: vec![ModelCompatibilityCheck {
                name: "TEXT_STREAM".into(),
                status: ModelCheckStatus::Passed,
                detail: "fixture".into(),
            }],
            settings: settings.clone(),
            provider_revision: 1,
            checked_at: 6,
        };
        storage
            .save_model_validation(id.clone(), key.clone(), model.clone(), 1, report.clone())
            .unwrap();
        assert!(
            storage
                .model_runtime(id.clone(), key.clone(), model.clone())
                .unwrap()
                .validation
                .is_some()
        );
        assert_eq!(
            storage
                .model_runtime(id.clone(), format!("{key}/other"), model.clone())
                .unwrap()
                .revision,
            0
        );
        assert_eq!(
            storage
                .model_runtime(id.clone(), key.clone(), "other-model".into())
                .unwrap()
                .revision,
            0
        );
        worker.shutdown();
        let worker = StorageWorker::start(&paths.database, device, 7).unwrap();
        let storage = worker.handle();
        assert_eq!(
            storage
                .model_runtime(id.clone(), key.clone(), model.clone())
                .unwrap()
                .settings,
            settings
        );
        storage
            .save_model_runtime(
                id.clone(),
                key.clone(),
                model.clone(),
                1,
                1,
                settings.clone(),
            )
            .unwrap();
        assert!(
            storage
                .model_runtime(id.clone(), key.clone(), model.clone())
                .unwrap()
                .validation
                .is_none()
        );
        assert!(matches!(
            storage.save_model_validation(
                id.clone(),
                key.clone(),
                model.clone(),
                1,
                report.clone()
            ),
            Err(DomainError::RevisionConflict)
        ));
        storage
            .save_model_validation(id.clone(), key.clone(), model.clone(), 2, report.clone())
            .unwrap();
        storage
            .set_provider_credential_present(id.clone(), true, 8)
            .unwrap();
        assert!(
            storage
                .model_runtime(id.clone(), key.clone(), model.clone())
                .unwrap()
                .validation
                .is_none()
        );
        assert!(matches!(
            storage.save_model_validation(id, key, model, 2, report),
            Err(DomainError::RevisionConflict)
        ));
        worker.shutdown();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn additive_migration_is_atomic_on_failure() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE provider_configs(id TEXT PRIMARY KEY);")
            .unwrap();
        {
            let tx = db.transaction().unwrap();
            assert!(
                tx.execute_batch(&format!("{MIGRATION_0017}\nTHIS IS NOT SQL;"))
                    .is_err()
            );
        }
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='model_runtime_settings'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
}
