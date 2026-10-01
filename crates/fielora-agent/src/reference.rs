//! Read-only reference scope supplied by the original user task, not by Tools.
use super::*;

pub fn display_path(path: &Path) -> String {
    relative_text(path).trim_start_matches("//?/").to_owned()
}

fn eligible(path: &Path) -> bool {
    let text = relative_text(path);
    path.is_absolute()
        && !text.starts_with("//")
        && !path.components().any(|c| matches!(c, Component::ParentDir))
        && !text.get(2..).unwrap_or("").contains(':')
        && !path.components().any(|c| {
            let part = Path::new(c.as_os_str());
            c.as_os_str().to_string_lossy().eq_ignore_ascii_case(".git") || sensitive_relative(part)
        })
}

/// Exact existing paths only. Quoting allows spaces. Never widen to a parent.
/// This function must receive the original trusted task, not generated prose.
pub fn explicit_paths(task: &str, target: &Path) -> Vec<PathBuf> {
    let matcher = regex::Regex::new(r#""([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z]:[\\/][^\s,，;；。<>\"'`]+|/[^\s,，;；。<>\"'`]+)"#).unwrap();
    let target = target.canonicalize().unwrap_or_else(|_| target.to_owned());
    let mut paths = Vec::new();
    for captures in matcher.captures_iter(task) {
        let Some(value) = captures.iter().skip(1).flatten().next() else {
            continue;
        };
        let path = Path::new(value.as_str());
        if !eligible(path) {
            continue;
        }
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if !eligible(Path::new(&display_path(&canonical))) {
            continue;
        }
        if canonical.starts_with(&target)
            || canonical.parent().is_none()
            || !matches!(canonical.metadata(), Ok(m) if m.is_file() || m.is_dir())
            || paths.contains(&canonical)
        {
            continue;
        }
        paths.push(canonical);
        if paths.len() == 16 {
            break;
        }
    }
    paths
}

/// A named source directory identifies a reference project. Include its local
/// dependencies using the nearest existing repository/package boundary. Exact
/// file references remain exact; never derive a root from model output.
pub fn read_roots(task: &str, target: &Path) -> Vec<PathBuf> {
    explicit_paths(task, target)
        .into_iter()
        .map(|path| {
            if path.is_file() {
                return path;
            }
            path.ancestors()
                .take(8)
                .find(|p| {
                    p.parent().is_some()
                        && eligible(Path::new(&display_path(p)))
                        && (p.join(".git").exists()
                            || p.join("package.json").is_file()
                            || p.join("Cargo.toml").is_file()
                            || p.join("pyproject.toml").is_file())
                })
                .map(Path::to_owned)
                .unwrap_or(path)
        })
        .collect()
}

/// Completion coverage is for requested source comparisons, not every absolute
/// path (e.g. an image or an export destination) appearing in a task.
pub fn comparison_paths(task: &str, target: &Path) -> Vec<PathBuf> {
    let lower = task.to_lowercase();
    if ![
        "参考",
        "参照",
        "对照",
        "比较",
        "一样",
        "去看",
        "compare",
        "reference",
        "adapt",
        "same as",
    ]
    .iter()
    .any(|word| lower.contains(word))
    {
        return vec![];
    }
    explicit_paths(task, target)
        .into_iter()
        .filter(|p| {
            p.is_dir()
                || p.extension().and_then(OsStr::to_str).is_some_and(|ext| {
                    matches!(
                        ext.to_ascii_lowercase().as_str(),
                        "js" | "jsx"
                            | "ts"
                            | "tsx"
                            | "cjs"
                            | "mjs"
                            | "json"
                            | "html"
                            | "css"
                            | "scss"
                            | "vue"
                            | "svelte"
                            | "rs"
                            | "py"
                            | "go"
                            | "java"
                            | "c"
                            | "cpp"
                            | "h"
                            | "cs"
                            | "rb"
                            | "php"
                            | "toml"
                            | "yaml"
                            | "yml"
                    )
                })
        })
        .collect()
}

impl ToolRuntime {
    pub fn with_reference_task(mut self, original_task: &str) -> Self {
        self.reference_paths = read_roots(original_task, &self.root);
        self
    }

    pub(super) fn observe_absolute(
        &self,
        name: &str,
        arguments: &Value,
    ) -> Result<ToolExecution, AgentError> {
        let raw = Path::new(
            arguments["path"]
                .as_str()
                .ok_or(AgentError::ToolArgumentsInvalid)?,
        );
        if !eligible(raw) {
            return Err(AgentError::WorkspaceEscape);
        }
        let canonical = raw.canonicalize().map_err(|_| AgentError::FileNotFound)?;
        if !eligible(Path::new(&display_path(&canonical))) {
            return Err(AgentError::WorkspaceEscape);
        }
        let reference = !canonical.starts_with(&self.root);
        let boundary = if reference {
            self.reference_paths
                .iter()
                .find(|p| canonical == **p || (p.is_dir() && canonical.starts_with(p)))
                .ok_or(AgentError::WorkspaceEscape)?
        } else {
            &self.root
        };
        let root = if boundary.is_file() {
            boundary.parent().ok_or(AgentError::WorkspaceEscape)?
        } else {
            boundary
        };
        let relative = canonical
            .strip_prefix(root)
            .map_err(|_| AgentError::WorkspaceEscape)?;
        deny_sensitive(relative)?;
        let mut args = arguments.clone();
        args["path"] = json!(if relative.as_os_str().is_empty() {
            ".".into()
        } else {
            relative_text(relative)
        });
        let scoped = Self {
            root: root.to_owned(),
            reference_paths: vec![],
            checkpoint_root: self.checkpoint_root.clone(),
            skill_catalog: self.skill_catalog.clone(),
            content_blob_store: None,
        };
        let mut result = match name {
            "read_file" => scoped.read_file(&args),
            "search_text" => scoped.search_text(&args),
            "list_files" => scoped.list_files(&args),
            "stat_path" => scoped.stat_path(&args),
            _ => Err(AgentError::ToolNotFound),
        }?;
        result.receipt["workspace_scope"] = json!(if reference { "REFERENCE" } else { "TARGET" });
        result.receipt["source_root"] = json!(display_path(root));
        if reference {
            result.receipt["reference_root"] = json!(display_path(boundary));
        }
        result.receipt["path"] = json!(display_path(&canonical));
        if let Some(files) = result.receipt["files"].as_object_mut() {
            *files = std::mem::take(files)
                .into_iter()
                .map(|(p, v)| (display_path(&root.join(p)), v))
                .collect();
        }
        if let Some(locations) = result.receipt["matched_locations"].as_array_mut() {
            for location in locations {
                if let Some(path) = location["path"].as_str() {
                    location["path"] = json!(display_path(&root.join(path)));
                }
            }
        }
        result.observation = format!(
            "Source root: {}. Scope: {}. All paths below belong to this source, not a different project.\n{}",
            display_path(root),
            if reference {
                "READ-ONLY REFERENCE"
            } else {
                "TARGET"
            },
            result.observation
        );
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_source_directory_reads_project_dependencies_but_not_adjacent_projects() {
        let base = std::env::temp_dir().join(format!("fielora-reference-deps-{}", Uuid::now_v7()));
        let target = base.join("target");
        let project = base.join("reference");
        let anchor = project.join("src/app/list");
        let dependency = project.join("src/templates/view.js");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&anchor).unwrap();
        fs::create_dir_all(dependency.parent().unwrap()).unwrap();
        fs::write(project.join("package.json"), "{}").unwrap();
        fs::write(anchor.join("controller.js"), "loadTemplate()").unwrap();
        fs::write(&dependency, "DISPLAY_LABEL").unwrap();
        fs::create_dir_all(project.join(".git")).unwrap();
        fs::write(project.join(".git/config"), "PROTECTED").unwrap();
        fs::write(base.join("unrelated.js"), "PRIVATE").unwrap();
        let task = format!("请对照 {}，保持接口不变", display_path(&anchor));
        assert_eq!(
            explicit_paths(&task, &target),
            vec![anchor.canonicalize().unwrap()]
        );
        assert_eq!(
            read_roots(&task, &target),
            vec![project.canonicalize().unwrap()]
        );
        let runtime = ToolRuntime::new(&target, &base.join("artifacts"))
            .unwrap()
            .with_reference_task(&task);
        let cancel = CommandCancellation::default();
        let read = runtime
            .execute(
                "read_file",
                &json!({"path":display_path(&dependency)}),
                false,
                &cancel,
            )
            .unwrap();
        assert!(read.observation.contains("DISPLAY_LABEL"));
        assert_eq!(
            read.receipt["path"],
            display_path(&dependency.canonicalize().unwrap())
        );
        assert_eq!(
            read.receipt["reference_root"],
            display_path(&project.canonicalize().unwrap())
        );
        for path in [base.join("unrelated.js"), project.join(".git/config")] {
            assert!(
                runtime
                    .execute(
                        "read_file",
                        &json!({"path":display_path(&path)}),
                        true,
                        &cancel
                    )
                    .is_err()
            );
        }
        let link = project.join("outside");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(base.join("unrelated.js"), &link);
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(base.join("unrelated.js"), &link);
        if linked.is_ok() {
            assert!(
                runtime
                    .execute(
                        "read_file",
                        &json!({"path":display_path(&link)}),
                        true,
                        &cancel
                    )
                    .is_err()
            );
            fs::remove_file(&link).unwrap();
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn explicit_reference_reads_do_not_grant_sibling_writes_or_change_target() {
        let base = std::env::temp_dir().join(format!("fielora-reference-{}", Uuid::now_v7()));
        let target = base.join("target");
        let reference = base.join("reference source");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&reference).unwrap();
        fs::write(target.join("view.js"), "TARGET").unwrap();
        fs::write(reference.join("view.js"), "REFERENCE LABEL").unwrap();
        fs::write(reference.join(".env"), "DO NOT READ").unwrap();
        fs::write(base.join("sibling.js"), "SIBLING").unwrap();
        let task = format!("对照 `{}` 修改当前项目，接口不变", display_path(&reference));
        let runtime = ToolRuntime::new(&target, &base.join("artifacts"))
            .unwrap()
            .with_reference_task(&task);
        let call = |name, args| runtime.execute(name, &args, true, &CommandCancellation::default());
        let read = call(
            "read_file",
            json!({"path":display_path(&reference.join("view.js"))}),
        )
        .unwrap();
        assert!(read.observation.contains("REFERENCE LABEL"));
        assert_eq!(read.receipt["workspace_scope"], "REFERENCE");
        assert!(
            call("read_file", json!({"path":"view.js"}))
                .unwrap()
                .observation
                .contains("TARGET")
        );
        let search = call(
            "search_text",
            json!({"path":display_path(&reference),"query":"LABEL"}),
        )
        .unwrap();
        assert_eq!(search.receipt["matches"], 1);
        assert_eq!(
            search.receipt["matched_locations"][0]["path"],
            display_path(&reference.join("view.js").canonicalize().unwrap())
        );
        for path in [
            base.join("sibling.js"),
            reference.join("../sibling.js"),
            reference.join(".env"),
        ] {
            assert!(call("read_file", json!({"path":display_path(&path)})).is_err());
        }
        assert!(call("write_file",json!({"path":display_path(&reference.join("view.js")),"content":"BAD","expected_sha256":sha256(b"REFERENCE LABEL")})).is_err());
        assert_eq!(
            fs::read_to_string(reference.join("view.js")).unwrap(),
            "REFERENCE LABEL"
        );
        let file_task = format!("参考 '{}'", display_path(&reference.join("view.js")));
        let file_only = ToolRuntime::new(&target, &base.join("artifacts"))
            .unwrap()
            .with_reference_task(&file_task);
        assert!(
            file_only
                .execute(
                    "list_files",
                    &json!({"path":display_path(&reference)}),
                    true,
                    &CommandCancellation::default()
                )
                .is_err()
        );
        fs::remove_dir_all(base).unwrap();
    }
}
