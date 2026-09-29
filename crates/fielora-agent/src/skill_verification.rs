//! Read-only, bounded installation checks. Skill text is data, never authority.
use crate::{AgentError, ContextCompiler, SkillCatalog, SkillSourceKind, ToolExecution, sha256};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

const MAX_FILES: usize = 2048;
const MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
#[derive(Default)]
struct InventoryBudget {
    bytes: u64,
    entries: usize,
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn guidance(detail: &str) -> AgentError {
    AgentError::WorkGuidance {
        code: "AGENT_SKILL_CHECK_INCOMPLETE",
        detail: detail.into(),
    }
}

// No symlinks/junctions, even when they point back inside the bundle. Bound all
// bytes before reading; the digest includes names and content, not timestamps.
fn inventory(
    root: &Path,
    directory: &Path,
    depth: usize,
    files: &mut BTreeMap<String, String>,
    budget: &mut InventoryBudget,
) -> Result<(), AgentError> {
    if depth > 16 {
        return Err(guidance(
            "Skill tree exceeds the bounded depth; no passing check was issued.",
        ));
    }
    for entry in fs::read_dir(directory).map_err(|_| AgentError::IoFailed)? {
        let entry = entry.map_err(|_| AgentError::IoFailed)?;
        budget.entries += 1;
        if budget.entries > 8192 {
            return Err(guidance("Skill tree exceeds the bounded entry count."));
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| AgentError::IoFailed)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(AgentError::WorkspaceEscape);
            }
        }
        if metadata.file_type().is_symlink() {
            return Err(AgentError::WorkspaceEscape);
        }
        let canonical = path.canonicalize().map_err(|_| AgentError::IoFailed)?;
        if !canonical.starts_with(root) {
            return Err(AgentError::WorkspaceEscape);
        }
        if metadata.is_dir() {
            inventory(root, &path, depth + 1, files, budget)?;
        } else if metadata.is_file() {
            if files.len() >= MAX_FILES
                || metadata.len() > MAX_ENTRY_BYTES
                || budget.bytes + metadata.len() > MAX_BYTES
            {
                return Err(guidance(
                    "Skill inventory exceeds file/byte limits; inspection is incomplete, not a pass.",
                ));
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| AgentError::WorkspaceEscape)?;
            crate::deny_sensitive(relative)?;
            let mut data = Vec::new();
            fs::File::open(&path)
                .map_err(|_| AgentError::IoFailed)?
                .take(MAX_ENTRY_BYTES + 1)
                .read_to_end(&mut data)
                .map_err(|_| AgentError::IoFailed)?;
            budget.bytes += data.len() as u64;
            if data.len() as u64 > MAX_ENTRY_BYTES || budget.bytes > MAX_BYTES {
                return Err(AgentError::FileTooLarge);
            }
            files.insert(relative.to_string_lossy().replace('\\', "/"), sha256(&data));
        } else {
            return Err(guidance("Unsupported filesystem entry in Skill bundle."));
        }
    }
    Ok(())
}

fn bundle_root(project: &Path, name: &str) -> Result<std::path::PathBuf, AgentError> {
    if !valid_name(name) {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let project = project.canonicalize().map_err(|_| AgentError::IoFailed)?;
    let mut path = project.clone();
    for part in [".agents", "skills", name] {
        path.push(part);
        let metadata = fs::symlink_metadata(&path).map_err(|_| AgentError::FileNotFound)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(AgentError::WorkspaceEscape);
            }
        }
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(AgentError::WorkspaceEscape);
        }
        if !path
            .canonicalize()
            .map_err(|_| AgentError::IoFailed)?
            .starts_with(&project)
        {
            return Err(AgentError::WorkspaceEscape);
        }
    }
    Ok(path)
}

pub fn bundle_digest(project: &Path, name: &str) -> Result<String, AgentError> {
    let root = bundle_root(project, name)?;
    let mut files = BTreeMap::new();
    inventory(&root, &root, 0, &mut files, &mut InventoryBudget::default())?;
    Ok(sha256(
        &serde_json::to_vec(&files).map_err(|_| AgentError::IoFailed)?,
    ))
}

fn references(text: &str) -> BTreeMap<String, String> {
    let mut paths = BTreeMap::new();
    // Static resource references are a bounded structural check, not a parser
    // for arbitrary shell programs, generated output names or natural language.
    let resources = Regex::new(r#"(?:^|[\s`\"'(])((?:\./)?(?:scripts|references|assets|bin|schemas|examples|renderers)/[A-Za-z0-9_./-]*)"#).unwrap();
    let links = Regex::new(r"\]\(([^\s)]+)\)").unwrap();
    for capture in resources
        .captures_iter(text)
        .chain(links.captures_iter(text))
    {
        let value = capture[1].split('#').next().unwrap_or("");
        if value.is_empty()
            || value.contains("://")
            || value.starts_with('#')
            || value.starts_with("mailto:")
        {
            continue;
        }
        let value = value.strip_prefix("./").unwrap_or(value).to_owned();
        paths.insert(value, "SKILL.md static reference".into());
    }
    paths
}

pub fn execute(project: &Path, arguments: &Value) -> Result<ToolExecution, AgentError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        name: String,
    }
    let Args { name } =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    let root = bundle_root(project, &name)?;
    let mut files = BTreeMap::new();
    inventory(&root, &root, 0, &mut files, &mut InventoryBudget::default())?;
    let digest = sha256(&serde_json::to_vec(&files).map_err(|_| AgentError::IoFailed)?);
    let mut diagnostics = Vec::new();
    let catalog = SkillCatalog::discover(project)?;
    let entry = catalog
        .entries()
        .iter()
        .find(|e| e.name == name && e.source_kind == SkillSourceKind::ProjectAgentSkill);
    let loadable = entry.is_some()
        && catalog
            .load_skill(&name, &ContextCompiler::default())
            .is_ok_and(|loaded| loaded.context.complete);
    if !loadable {
        diagnostics.push(
            json!({"code":"SKILL_NOT_LOADABLE","path":"SKILL.md","details":catalog.diagnostics()}),
        );
    }
    let mut text_bytes = Vec::new();
    fs::File::open(root.join("SKILL.md"))
        .map_err(|_| AgentError::FileNotFound)?
        .take(256 * 1024 + 1)
        .read_to_end(&mut text_bytes)
        .map_err(|_| AgentError::IoFailed)?;
    if text_bytes.len() > 256 * 1024 {
        return Err(AgentError::FileTooLarge);
    }
    if files.get("SKILL.md") != Some(&sha256(&text_bytes)) {
        return Err(AgentError::FileChanged);
    }
    let text = std::str::from_utf8(&text_bytes).map_err(|_| AgentError::BinaryFileUnsupported)?;
    let refs = references(text);
    if refs.len() > 256 {
        return Err(guidance(
            "Too many static references; no complete inspection was issued.",
        ));
    }
    for path in refs.keys() {
        let safe = crate::normalize_relative(path).and_then(|p| {
            crate::deny_sensitive(&p)?;
            Ok(p)
        });
        if safe.is_err() {
            diagnostics.push(json!({"code":"SKILL_REFERENCE_UNSAFE","path":path}));
        } else if !files.contains_key(path)
            && !files
                .keys()
                .any(|f| f.starts_with(&format!("{}/", path.trim_end_matches('/'))))
        {
            diagnostics.push(json!({"code":"SKILL_RESOURCE_MISSING","path":path}));
        }
    }
    let executable = files.keys().any(|p| {
        [
            "js", "mjs", "cjs", "ts", "py", "sh", "ps1", "exe", "cmd", "bat",
        ]
        .iter()
        .any(|ext| p.ends_with(&format!(".{ext}")))
    });
    let success = loadable && diagnostics.is_empty();
    let receipt = json!({"kind":"SKILL_INSTALLATION_CHECK_V1","name":name,"path":format!(".agents/skills/{name}"),
        "success":success,"bundle_sha256":digest,"file_count":files.len(),"loadable":loadable,
        "referenced_resources":refs.keys().collect::<Vec<_>>(),"diagnostics":diagnostics,
        "runtime_check_required":executable,"runtime_verified":false,"authority":"UNTRUSTED_PROJECT",
        "coverage":"Frontmatter, current loadability, bounded whole-bundle digest, static SKILL.md resource references. No upstream manifest, dynamic/transitive dependency or runtime proof.",
        "next_action":if !success {"For a status question, report the missing/invalid resources and that installation is incomplete; this negative check is valid observation evidence. Only if the current request requires installation/repair, fetch/repair resources from the observed source using admitted tools and rerun verify_skill. Do not fabricate placeholders or ask for a source already recorded."} else if executable {"For a status question, report the structural pass and unverified runtime. If installation/runtime verification is required, run the Skill's targeted doctor/test/check with run_command under existing policy, then rerun verify_skill if files changed. File existence alone does not prove runtime readiness."} else {"Structural installation check passed for this exact bundle. Report this scope; do not claim untested execution behavior."}});
    Ok(ToolExecution {
        observation: serde_json::to_string_pretty(&receipt).unwrap_or_default(),
        receipt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, std::path::PathBuf) {
        let project =
            std::env::temp_dir().join(format!("fielora-skill-check-{}", uuid::Uuid::now_v7()));
        let skill = project.join(".agents/skills/sample");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nname: sample\ndescription: Fixture.\n---\nRun `node bin/main.mjs doctor`. Read [guide](references/guide.md#setup) and `assets/template.html`.\n").unwrap();
        (project, skill)
    }
    #[test]
    fn installation_requires_resources_and_digest_tracks_every_file() {
        let (project, skill) = fixture();
        let first = execute(&project, &json!({"name":"sample"}))
            .unwrap()
            .receipt;
        assert_eq!(first["success"], false);
        assert_eq!(first["diagnostics"].as_array().unwrap().len(), 3);
        for path in [
            "bin/main.mjs",
            "references/guide.md",
            "assets/template.html",
        ] {
            let target = skill.join(path);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, "fixture").unwrap();
        }
        let complete = execute(&project, &json!({"name":"sample"}))
            .unwrap()
            .receipt;
        assert_eq!(complete["success"], true);
        assert_eq!(complete["runtime_check_required"], true);
        assert_eq!(complete["runtime_verified"], false);
        assert_ne!(first["bundle_sha256"], complete["bundle_sha256"]);
        fs::write(skill.join("assets/template.html"), "changed").unwrap();
        assert_ne!(
            bundle_digest(&project, "sample").unwrap(),
            complete["bundle_sha256"].as_str().unwrap()
        );
        fs::remove_dir_all(project).unwrap();
    }
    #[test]
    fn entry_only_skills_are_valid_but_paths_and_oversize_are_not() {
        let (project, skill) = fixture();
        fs::write(skill.join("SKILL.md"),"---\nname: sample\ndescription: Explain concepts.\n---\nNo bundled resources. [Web](https://example.com/guide).\n").unwrap();
        let r = execute(&project, &json!({"name":"sample"}))
            .unwrap()
            .receipt;
        assert_eq!(r["success"], true);
        assert_eq!(r["runtime_check_required"], false);
        assert!(execute(&project, &json!({"name":"../outside"})).is_err());
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: sample\ndescription: Fixture.\n---\n[unsafe](../../secret.txt)\n",
        )
        .unwrap();
        assert_eq!(
            execute(&project, &json!({"name":"sample"}))
                .unwrap()
                .receipt["success"],
            false
        );
        fs::write(
            skill.join("large.bin"),
            vec![0; MAX_ENTRY_BYTES as usize + 1],
        )
        .unwrap();
        assert!(execute(&project, &json!({"name":"sample"})).is_err());
        fs::remove_dir_all(project).unwrap();
    }
}
