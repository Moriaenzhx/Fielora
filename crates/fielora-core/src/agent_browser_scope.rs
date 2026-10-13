//! Trusted Host resource facts bind only the inputs of recorded browser assertions.
//! Unknown/legacy observations keep the existing global workspace revision.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path};

pub(crate) fn admit(receipt: &mut Value, project: &Path) {
    let Some(scope) = receipt.get("verification_scope") else {
        return;
    };
    let admitted = scope["root"].as_str().is_some_and(|root| {
        let root = Path::new(root);
        project.canonicalize().ok().is_some_and(|project| {
            root.is_absolute()
                && root.starts_with(project)
                && root.canonicalize().ok().as_deref() == Some(root)
        })
    });
    if !admitted && let Some(object) = receipt.as_object_mut() {
        object.remove("verification_scope");
    }
}

pub(crate) fn fresh(receipt: &Value, global: Option<&str>) -> bool {
    match receipt.get("verification_scope") {
        None => global.is_some() && receipt["workspace_revision"].as_str() == global,
        Some(scope) => scoped_fresh(scope, receipt["url"].as_str()),
    }
}

pub(crate) fn scoped_fresh(scope: &Value, url: Option<&str>) -> bool {
    if scope["version"] != "STATIC_PREVIEW_HTTP_V1"
        || scope["closure"] != "HOST_STATIC_RESPONSES_NATIVE_PAGE_REQUESTS"
        || url.is_none()
        || scope["url"].as_str() != url
    {
        return false;
    }
    let Some(root) = scope["root"].as_str().map(Path::new) else {
        return false;
    };
    if !root.is_absolute() || root.canonicalize().ok().as_deref() != Some(root) {
        return false;
    }
    let Some(files) = scope["files"]
        .as_array()
        .filter(|files| !files.is_empty() && files.len() <= 64)
    else {
        return false;
    };
    let mut total = 0_u64;
    files.iter().all(|fact| {
        let Some(relative) = fact["path"].as_str().map(Path::new) else {
            return false;
        };
        if relative.as_os_str().is_empty()
            || !relative
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            return false;
        }
        let file = root.join(relative);
        if file.canonicalize().ok().as_ref() != Some(&file) {
            return false;
        }
        let Ok(metadata) = std::fs::metadata(&file) else {
            return false;
        };
        total = total.saturating_add(metadata.len());
        if !metadata.is_file()
            || metadata.len() > 2 * 1024 * 1024
            || total > 16 * 1024 * 1024
            || fact["bytes"].as_u64() != Some(metadata.len())
        {
            return false;
        }
        let Ok(file) = std::fs::File::open(file) else {
            return false;
        };
        let mut bytes = Vec::new();
        if file
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .is_err()
            || bytes.len() > 2 * 1024 * 1024
            || fact["bytes"].as_u64() != Some(bytes.len() as u64)
        {
            return false;
        }
        fact["sha256"].as_str() == Some(format!("{:x}", Sha256::digest(bytes)).as_str())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn source_scope_keeps_unrelated_notes_but_invalidates_all_actual_dependencies() {
        let root =
            std::env::temp_dir().join(format!("fielora-browser-scope-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let files = ["index.html", "logic.js", "style.css", "data.md"];
        let facts: Vec<Value> = files
            .iter()
            .map(|path| {
                std::fs::write(root.join(path), b"original").unwrap();
                json!({"path":path,"bytes":8,"sha256":format!("{:x}",Sha256::digest(b"original"))})
            })
            .collect();
        let mut receipt = json!({"url":"http://127.0.0.1:1/page/","workspace_revision":"old",
            "verification_scope":{"version":"STATIC_PREVIEW_HTTP_V1","closure":"HOST_STATIC_RESPONSES_NATIVE_PAGE_REQUESTS",
            "root":root,"url":"http://127.0.0.1:1/page/","files":facts}});
        assert!(fresh(&receipt, Some("new-global")));
        std::fs::write(root.join("README.md"), b"new delivery notes").unwrap();
        assert!(fresh(&receipt, Some("notes-changed")));
        for file in files {
            std::fs::write(root.join(file), b"modified").unwrap();
            assert!(!fresh(&receipt, Some("old")), "{file} is an actual input");
            std::fs::write(root.join(file), b"original").unwrap();
        }
        receipt["url"] = json!("http://127.0.0.1:1/other");
        assert!(!fresh(&receipt, Some("old")));
        receipt
            .as_object_mut()
            .unwrap()
            .remove("verification_scope");
        assert!(
            !fresh(&receipt, Some("new-global")),
            "Legacy receipts remain conservative"
        );
        assert!(fresh(&receipt, Some("old")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scope_requires_trusted_project_containment_and_complete_bounded_file_facts() {
        let root = std::env::temp_dir().join(format!(
            "fielora-browser-scope-invalid-{}",
            uuid::Uuid::now_v7()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let mut receipt = json!({"url":"http://localhost/", "verification_scope":{"root":root,"version":"STATIC_PREVIEW_HTTP_V1","url":"http://localhost/","closure":"HOST_STATIC_RESPONSES_NATIVE_PAGE_REQUESTS","files":[]}});
        assert!(!fresh(&receipt, Some("same")));
        admit(&mut receipt, &root.join("another-project"));
        assert!(receipt.get("verification_scope").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
