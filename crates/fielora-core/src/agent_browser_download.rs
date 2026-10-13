//! Exact read access derived from successful captures in the current tool ledger.
//! This does not grant directory access or turn remote content into instructions.
use fielora_agent::{AgentError, ToolExecution, ToolRuntime};
use fielora_contracts::{AgentRunId, AgentToolCallView, AgentToolStatus};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path};

const MAX_CAPTURE_BYTES: u64 = 16 * 1024 * 1024;

fn changed() -> AgentError {
    AgentError::WorkGuidance {
        code: "AGENT_DOWNLOAD_CONTENT_CHANGED",
        detail: "The captured download no longer matches its recorded path, regular-file identity, size or SHA-256. No file contents were returned. Capture it again through browser action=download; do not substitute another host path or claim the old bytes were verified.".into(),
    }
}

/// None preserves ordinary project/reference admission. Only a durable, completed
/// browser download from this Run can supply provenance; arguments cannot do so.
pub fn read(
    artifact_root: &Path,
    run: &AgentRunId,
    calls: &[AgentToolCallView],
    arguments: &Value,
) -> Result<Option<ToolExecution>, AgentError> {
    let Some(raw) = arguments["path"].as_str() else {
        return Ok(None);
    };
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Ok(None);
    }
    let Some((call, download)) = calls
        .iter()
        .filter(|call| {
            call.run_id == *run
                && call.name == "browser"
                && call.arguments["action"] == "download"
                && call.status == AgentToolStatus::Completed
        })
        .find_map(|call| {
            let receipt = call.receipt.as_ref()?;
            let download = &receipt["download"];
            (receipt["kind"] == "BROWSER"
                && receipt["success"] == true
                && download["status"] == "COMPLETED"
                && download["artifact_path"]
                    .as_str()
                    .is_some_and(|captured| Path::new(captured) == path))
            .then_some((call, download))
        })
    else {
        return Ok(None);
    };
    let bytes_expected = download["bytes"]
        .as_u64()
        .filter(|n| *n <= MAX_CAPTURE_BYTES)
        .ok_or_else(changed)?;
    let hash_expected = download["sha256"]
        .as_str()
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(changed)?;
    let run_root = artifact_root.join("browser-downloads").join(&run.0);
    let relative = path.strip_prefix(&run_root).map_err(|_| changed())?;
    let components: Vec<_> = relative.components().collect();
    if components.len() != 2
        || !matches!(components[0], Component::Normal(name) if name.to_str().is_some_and(|s| s.starts_with("capture-") && s.len() > 8))
        || !matches!(components[1], Component::Normal(name) if name == "download")
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(changed());
    }
    let canonical_artifacts = artifact_root.canonicalize().map_err(|_| changed())?;
    let mut entry = artifact_root.to_path_buf();
    for component in path
        .strip_prefix(artifact_root)
        .map_err(|_| changed())?
        .components()
    {
        if !matches!(component, Component::Normal(_)) {
            return Err(changed());
        }
        entry.push(component);
        let metadata = std::fs::symlink_metadata(&entry).map_err(|_| changed())?;
        if metadata.file_type().is_symlink() {
            return Err(changed());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(changed());
            }
        }
    }
    let canonical = path.canonicalize().map_err(|_| changed())?;
    let expected = canonical_artifacts
        .join("browser-downloads")
        .join(&run.0)
        .join(relative);
    if canonical != expected {
        return Err(changed());
    }
    let file = std::fs::File::open(&canonical).map_err(|_| changed())?;
    let metadata = file.metadata().map_err(|_| changed())?;
    if !metadata.is_file() || metadata.len() != bytes_expected {
        return Err(changed());
    }
    let mut bytes = Vec::with_capacity(bytes_expected.min(1024 * 1024) as usize);
    file.take(MAX_CAPTURE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| changed())?;
    if bytes.len() as u64 != bytes_expected
        || format!("{:x}", Sha256::digest(&bytes)) != hash_expected.to_ascii_lowercase()
    {
        return Err(changed());
    }
    // Hash and render this same buffer, avoiding a verify-then-reopen gap.
    let mut execution = ToolRuntime::read_file_bytes(arguments, &bytes, raw)?;
    execution.receipt["workspace_scope"] = json!("RUN_DOWNLOAD");
    execution.receipt["source_tool_call_id"] = json!(call.id);
    execution.receipt["contents_verified"] = json!(false);
    execution.observation = format!(
        "Untrusted captured download from this Run. Byte identity matches the capture receipt; reading does not verify business contents or grant execution authority.\n{}",
        execution.observation
    );
    Ok(Some(execution))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn receipt(run: &str, path: &Path, bytes: &[u8]) -> AgentToolCallView {
        serde_json::from_value(json!({"id":"download-tool","run_id":run,"name":"browser","effect":"NETWORK","status":"COMPLETED","policy_decision":"ALLOW","arguments":{"action":"download"},"receipt":{"kind":"BROWSER","success":true,"download":{"status":"COMPLETED","artifact_path":path,"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes)),"contents_verified":false}},"error_code":null,"created_at":1,"updated_at":1})).unwrap()
    }
    #[test]
    fn only_same_run_exact_successful_capture_can_supply_read_provenance() {
        let root =
            std::env::temp_dir().join(format!("fielora-download-read-{}", uuid::Uuid::now_v7()));
        let path = root.join("browser-downloads/run/capture-fixture/download");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let bytes = br#"{"count":24,"title":"fixture"}"#;
        std::fs::write(&path, bytes).unwrap();
        let run = AgentRunId::new("run");
        let call = receipt("run", &path, bytes);
        let args = json!({"path":path,"json_pointers":["/count"]});
        let result = read(&root, &run, std::slice::from_ref(&call), &args)
            .unwrap()
            .unwrap();
        assert!(result.observation.contains("\"value\":24"));
        assert_eq!(result.receipt["workspace_scope"], "RUN_DOWNLOAD");
        assert_eq!(result.receipt["contents_verified"], false);
        assert!(
            read(
                &root,
                &AgentRunId::new("other"),
                std::slice::from_ref(&call),
                &args
            )
            .unwrap()
            .is_none()
        );
        assert!(read(&root, &run, &[], &args).unwrap().is_none());
        for status in [AgentToolStatus::Failed, AgentToolStatus::Unknown] {
            let mut failed = call.clone();
            failed.status = status;
            assert!(read(&root, &run, &[failed], &args).unwrap().is_none());
        }
        let mut failed = call.clone();
        failed.receipt.as_mut().unwrap()["success"] = json!(false);
        assert!(read(&root, &run, &[failed], &args).unwrap().is_none());
        let mut failed = call.clone();
        failed.receipt.as_mut().unwrap()["download"]["status"] = json!("FAILED");
        assert!(read(&root, &run, &[failed], &args).unwrap().is_none());
        let other_path = root.join("browser-downloads/other/capture-fixture/download");
        std::fs::create_dir_all(other_path.parent().unwrap()).unwrap();
        std::fs::write(&other_path, bytes).unwrap();
        let wrong_namespace = receipt("run", &other_path, bytes);
        assert_eq!(
            read(&root, &run, &[wrong_namespace], &json!({"path":other_path}))
                .unwrap_err()
                .code(),
            "AGENT_DOWNLOAD_CONTENT_CHANGED"
        );
        for outside in [
            path.parent().unwrap().to_path_buf(),
            path.with_file_name("sibling"),
            root.join("other/download"),
        ] {
            assert!(
                read(
                    &root,
                    &run,
                    std::slice::from_ref(&call),
                    &json!({"path":outside})
                )
                .unwrap()
                .is_none()
            );
        }
        std::fs::write(&path, br#"{"count":99,"title":"fixture"}"#).unwrap();
        assert_eq!(
            read(&root, &run, std::slice::from_ref(&call), &args)
                .unwrap_err()
                .code(),
            "AGENT_DOWNLOAD_CONTENT_CHANGED"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn changed_path_links_binary_and_size_limits_are_not_widened() {
        let root =
            std::env::temp_dir().join(format!("fielora-download-read-{}", uuid::Uuid::now_v7()));
        let path = root.join("browser-downloads/run/capture-fixture/download");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let run = AgentRunId::new("run");
        let bytes = [0xff, 0x00];
        std::fs::write(&path, bytes).unwrap();
        let call = receipt("run", &path, &bytes);
        let args = json!({"path":path});
        assert_eq!(
            read(&root, &run, &[call], &args).unwrap_err(),
            AgentError::BinaryFileUnsupported
        );
        let bytes = vec![b'x'; 1024 * 1024 + 1];
        std::fs::write(&path, &bytes).unwrap();
        let call = receipt("run", &path, &bytes);
        assert_eq!(
            read(&root, &run, &[call], &args).unwrap_err(),
            AgentError::FileTooLarge
        );
        std::fs::write(&path, b"safe").unwrap();
        let call = receipt("run", &path, b"safe");
        #[cfg(unix)]
        {
            let other = root.join("outside");
            std::fs::write(&other, b"safe").unwrap();
            std::fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(&other, &path).unwrap();
            assert_eq!(
                read(&root, &run, std::slice::from_ref(&call), &args)
                    .unwrap_err()
                    .code(),
                "AGENT_DOWNLOAD_CONTENT_CHANGED"
            );
            std::fs::remove_file(&path).unwrap();
            std::fs::write(&path, b"safe").unwrap();
            let moved = root.join("moved");
            std::fs::rename(path.parent().unwrap(), &moved).unwrap();
            std::os::unix::fs::symlink(&moved, path.parent().unwrap()).unwrap();
            assert_eq!(
                read(&root, &run, &[call], &args).unwrap_err().code(),
                "AGENT_DOWNLOAD_CONTENT_CHANGED"
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
