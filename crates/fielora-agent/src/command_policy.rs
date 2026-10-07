//! Host-derived command approval facts. A recognized install is not a safety
//! claim: its automatic route additionally requires the OS write sandbox.

use crate::{AgentError, ToolRuntime, installation_command, resolve_command_cwd};
use fielora_contracts::{AgentPermission, AgentPolicyDecision};
use serde_json::{Value, json};
use std::path::Path;

pub const METADATA: &str = "_command_policy";

fn project_file(root: &Path, cwd: &Path, path: &str) -> bool {
    let path = cwd.join(path);
    path.canonicalize().is_ok_and(|p| {
        p.starts_with(root) && p.is_file() && p.metadata().is_ok_and(|m| m.len() <= 1024 * 1024)
    })
}

pub fn project_install(root: &Path, arguments: &Value) -> Option<&'static str> {
    let root = root.canonicalize().ok()?;
    let cwd = resolve_command_cwd(&root, arguments["cwd"].as_str().unwrap_or(".")).ok()?;
    let program = arguments["program"].as_str()?;
    let name = Path::new(program)
        .file_stem()?
        .to_str()?
        .to_ascii_lowercase();
    let argv = arguments["argv"]
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if matches!(name.as_str(), "npm" | "pnpm" | "yarn") {
        if !project_file(&root, &cwd, "package.json") || argv.is_empty() {
            return None;
        }
        if !(argv[0] == "install" || name == "npm" && argv[0] == "ci")
            || argv[1..].iter().any(|a| {
                !matches!(
                    *a,
                    "--no-audit"
                        | "--no-fund"
                        | "--ignore-scripts"
                        | "--frozen-lockfile"
                        | "--immutable"
                        | "--offline"
                )
            })
        {
            return None;
        }
        return Some("PROJECT_NODE_DEPENDENCIES");
    }
    let python = name.starts_with("python");
    let pip = name.starts_with("pip");
    if !python && !pip {
        return None;
    }
    let suffix = name.strip_prefix(if python { "python" } else { "pip" })?;
    if !suffix.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    // The venv executable is normally a symlink to the host interpreter.
    // Its bin/Scripts directory and pyvenv.cfg must belong to this Project.
    let executable = cwd.join(program);
    if !executable.is_file() {
        return None;
    }
    let bin = executable.parent()?.canonicalize().ok()?;
    if !matches!(bin.file_name()?.to_str()?, "bin" | "Scripts") {
        return None;
    }
    let venv = bin.parent()?;
    if !venv.starts_with(&root) || venv == root {
        return None;
    }
    let config = venv.join("pyvenv.cfg").canonicalize().ok()?;
    if !config.starts_with(venv) || config.metadata().ok()?.len() > 16 * 1024 {
        return None;
    }
    let config_text = std::fs::read_to_string(config).ok()?;
    if !config_text.lines().any(|line| {
        line.split_once('=').is_some_and(|(key, value)| {
            key.trim()
                .eq_ignore_ascii_case("include-system-site-packages")
                && value.trim().eq_ignore_ascii_case("false")
        })
    }) {
        return None;
    }
    let mut args = argv.as_slice();
    if python {
        args = args.strip_prefix(&["-m", "pip"])?;
    }
    args = args.strip_prefix(&["install"])?;
    let mut requirement = false;
    while let Some((first, rest)) = args.split_first() {
        args = rest;
        match *first {
            "-r" | "--requirement" if !requirement => {
                let (path, rest) = args.split_first()?;
                if !project_file(&root, &cwd, path) {
                    return None;
                }
                requirement = true;
                args = rest;
            }
            "--no-input" | "--disable-pip-version-check" | "--no-cache-dir" => {}
            _ => return None,
        }
    }
    requirement.then_some("PROJECT_PYTHON_DEPENDENCIES")
}

pub fn preview(root: &Path, permission: AgentPermission, arguments: &Value) -> Value {
    let sandbox = fielora_platform::command_sandbox::available();
    let install = installation_command(arguments);
    let project_install = install.then(|| project_install(root, arguments)).flatten();
    let automatic_install =
        permission == AgentPermission::FullControl && project_install.is_some() && sandbox;
    let reason = if automatic_install {
        "PROJECT_DEPENDENCIES"
    } else if install {
        if project_install.is_some() && !sandbox {
            "SANDBOX_UNAVAILABLE"
        } else {
            "INSTALLATION_REQUIRES_APPROVAL"
        }
    } else if permission == AgentPermission::ReadOnly {
        "REQUEST_APPROVAL"
    } else if permission == AgentPermission::ReviewChanges && !sandbox {
        "SANDBOX_UNAVAILABLE"
    } else if permission == AgentPermission::ReviewChanges && crate::dangerous_command(arguments) {
        "RISKY_COMMAND"
    } else {
        "PRESET_ALLOWED"
    };
    json!({
        "version":1,
        "reason":reason,
        "project_install":project_install,
        "automatic_project_install":automatic_install,
        "sandbox_available":sandbox,
        "automatic_boundary":if automatic_install || permission == AgentPermission::ReviewChanges && reason == "PRESET_ALLOWED" { "MACOS_WORKSPACE_WRITE_SANDBOX" } else { "CURRENT_USER_HOST" },
        "approved_boundary":"CURRENT_USER_HOST"
    })
}

pub fn decision(
    root: &Path,
    permission: AgentPermission,
    arguments: &Value,
) -> AgentPolicyDecision {
    let facts = preview(root, permission, arguments);
    if facts["automatic_project_install"] == true || facts["reason"] == "PRESET_ALLOWED" {
        AgentPolicyDecision::Allow
    } else {
        AgentPolicyDecision::Ask
    }
}

impl ToolRuntime {
    /// Set only by the trusted Harness for a FullControl project-install route.
    /// Re-evaluate all filesystem facts immediately before command launch.
    pub fn with_project_install_sandbox(mut self, enabled: bool) -> Self {
        self.project_install_sandbox = enabled;
        self
    }

    pub(crate) fn verify_project_install(&self, arguments: &Value) -> Result<(), AgentError> {
        if self.project_install_sandbox && project_install(&self.root, arguments).is_none() {
            return Err(AgentError::WorkGuidance {
                code: "AGENT_PROJECT_INSTALL_CHANGED",
                detail: "Project dependency installation facts changed. Inspect the project environment and propose a new command; the previous permission cannot authorize this changed target.".into(),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CommandCancellation, ToolExecutor};
    use std::fs;

    fn fixture() -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("fielora-install-policy-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(root.join(".venv/bin")).unwrap();
        fs::write(root.join(".venv/bin/python3"), "fixture executable").unwrap();
        fs::write(
            root.join(".venv/pyvenv.cfg"),
            "include-system-site-packages = false\n",
        )
        .unwrap();
        fs::write(root.join("requirements.txt"), "fixture==1\n").unwrap();
        fs::write(root.join("package.json"), "{\"private\":true}\n").unwrap();
        root
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandboxed_commands_cancel_timeout_and_clean_up_descendants() {
        use std::time::{Duration, Instant};
        for mode in ["cancel", "timeout"] {
            let root = fixture();
            let artifacts = root.join("artifacts");
            fs::write(root.join("wait.py"), "import subprocess,pathlib\np=subprocess.Popen(['/bin/sleep','30'])\npathlib.Path('child.pid').write_text(str(p.pid))\np.wait()\n").unwrap();
            let runtime = ToolRuntime::new(&root, &artifacts).unwrap();
            let cancel = CommandCancellation::default();
            let worker_cancel = cancel.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            let worker = std::thread::spawn(move || {
                tx.send(runtime.execute(
                    "run_command",
                    &json!({"program":"/usr/bin/python3","argv":["wait.py"],"timeout_ms":1000}),
                    false,
                    &worker_cancel,
                ))
                .unwrap();
            });
            let deadline = Instant::now() + Duration::from_secs(3);
            while !root.join("child.pid").exists() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            let pid = fs::read_to_string(root.join("child.pid")).unwrap();
            if mode == "cancel" {
                cancel.cancel();
            }
            let error = rx
                .recv_timeout(Duration::from_secs(5))
                .expect("sandboxed process/pipe did not close")
                .unwrap_err();
            assert_eq!(
                error,
                if mode == "cancel" {
                    AgentError::Cancelled
                } else {
                    AgentError::CommandTimeout
                }
            );
            worker.join().unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let out = std::process::Command::new("/bin/ps")
                    .args(["-o", "stat=", "-p", pid.trim()])
                    .output()
                    .unwrap();
                let state = String::from_utf8_lossy(&out.stdout);
                if state.trim().is_empty() || state.trim().starts_with('Z') {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "sandboxed descendant still running"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn project_installs_require_host_facts_and_explicit_full_control() {
        let root = fixture();
        let args = json!({"program":root.join(".venv/bin/python3"),"argv":["-m","pip","install","-r","requirements.txt"]});
        assert_eq!(
            project_install(&root, &args),
            Some("PROJECT_PYTHON_DEPENDENCIES")
        );
        let full = decision(&root, AgentPermission::FullControl, &args);
        assert_eq!(
            full,
            if fielora_platform::command_sandbox::available() {
                AgentPolicyDecision::Allow
            } else {
                AgentPolicyDecision::Ask
            }
        );
        for permission in [AgentPermission::ReadOnly, AgentPermission::ReviewChanges] {
            assert_eq!(decision(&root, permission, &args), AgentPolicyDecision::Ask);
        }
        for program in ["/usr/bin/python3", "python3", "pip3"] {
            let bad = json!({"program":program,"argv":["-m","pip","install","-r","requirements.txt"],"_command_policy":{"automatic_project_install":true}});
            assert_eq!(project_install(&root, &bad), None);
            assert_eq!(
                decision(&root, AgentPermission::FullControl, &bad),
                AgentPolicyDecision::Ask
            );
        }
        for argv in [
            vec!["-m", "pip", "install", "--user", "-r", "requirements.txt"],
            vec![
                "-m",
                "pip",
                "install",
                "--target",
                "/tmp/other",
                "-r",
                "requirements.txt",
            ],
            vec!["-m", "pip", "install", "-r", "../requirements.txt"],
            vec!["-m", "pip", "install", "unknown-package"],
        ] {
            assert!(
                project_install(
                    &root,
                    &json!({"program":root.join(".venv/bin/python3"),"argv":argv})
                )
                .is_none()
            );
        }
        for program in ["npm", "pnpm", "yarn"] {
            assert_eq!(
                project_install(&root, &json!({"program":program,"argv":["install"]})),
                Some("PROJECT_NODE_DEPENDENCIES")
            );
            for args in [
                vec!["install", "-g"],
                vec!["install", "--prefix", "/tmp"],
                vec!["install", "--config", "elsewhere"],
                vec!["install", "&&", "other"],
            ] {
                assert!(project_install(&root, &json!({"program":program,"argv":args})).is_none());
            }
        }
        assert!(
            project_install(
                &root,
                &json!({"program":"/bin/sh","argv":["-c","npm install"]})
            )
            .is_none()
        );
        let runtime = ToolRuntime::new(&root, &root.join("artifacts"))
            .unwrap()
            .with_project_install_sandbox(true);
        fs::remove_file(root.join(".venv/pyvenv.cfg")).unwrap();
        assert_eq!(
            runtime
                .execute("run_command", &args, true, &CommandCancellation::default())
                .unwrap_err()
                .code(),
            "AGENT_PROJECT_INSTALL_CHANGED"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn project_install_rejects_symlinked_environment_and_manifest_escapes() {
        use std::os::unix::fs::symlink;
        let root = fixture();
        let other = fixture();
        fs::remove_dir_all(root.join(".venv")).unwrap();
        symlink(other.join(".venv"), root.join(".venv")).unwrap();
        let args = json!({"program":root.join(".venv/bin/python3"),"argv":["-m","pip","install","-r","requirements.txt"]});
        assert!(project_install(&root, &args).is_none());
        fs::remove_file(root.join("package.json")).unwrap();
        symlink(other.join("package.json"), root.join("package.json")).unwrap();
        assert!(project_install(&root, &json!({"program":"npm","argv":["install"]})).is_none());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_python_dependency_install_is_offline_project_scoped_and_sandboxed() {
        use std::io::Write;
        use std::process::Command;
        let root = fixture();
        fs::remove_dir_all(root.join(".venv")).unwrap();
        let created = Command::new("/usr/bin/python3")
            .args(["-m", "venv"])
            .arg(root.join(".venv"))
            .output()
            .unwrap();
        assert!(
            created.status.success(),
            "{}",
            String::from_utf8_lossy(&created.stderr)
        );
        let wheel_name = "fielora_probe-0.0.1-py3-none-any.whl";
        let mut wheel = zip::ZipWriter::new(fs::File::create(root.join(wheel_name)).unwrap());
        for (name, body) in [
            ("fielora_probe.py", "VALUE = 'installed and imported'\n"),
            (
                "fielora_probe-0.0.1.dist-info/METADATA",
                "Metadata-Version: 2.1\nName: fielora-probe\nVersion: 0.0.1\n",
            ),
            (
                "fielora_probe-0.0.1.dist-info/WHEEL",
                "Wheel-Version: 1.0\nGenerator: fielora-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
            ),
            ("fielora_probe-0.0.1.dist-info/RECORD", ""),
        ] {
            wheel
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            wheel.write_all(body.as_bytes()).unwrap();
        }
        wheel.finish().unwrap();
        fs::write(
            root.join("requirements.txt"),
            format!("--no-index\n{wheel_name}\n"),
        )
        .unwrap();
        let runtime = ToolRuntime::new(&root, &root.join("artifacts"))
            .unwrap()
            .with_project_install_sandbox(true);
        let args = json!({"program":root.join(".venv/bin/python3"),"argv":["-m","pip","install","--disable-pip-version-check","-r","requirements.txt"],"timeout_ms":30000});
        assert_eq!(
            decision(&root, AgentPermission::FullControl, &args),
            AgentPolicyDecision::Allow
        );
        let installed = runtime
            .execute("run_command", &args, true, &CommandCancellation::default())
            .unwrap();
        assert_eq!(
            installed.receipt["success"], true,
            "{}",
            installed.observation
        );
        assert_eq!(
            installed.receipt["execution_boundary"],
            "MACOS_WORKSPACE_WRITE_SANDBOX"
        );
        let imported = Command::new(root.join(".venv/bin/python3"))
            .args(["-c", "import fielora_probe; print(fielora_probe.VALUE)"])
            .output()
            .unwrap();
        assert!(imported.status.success());
        assert_eq!(
            String::from_utf8_lossy(&imported.stdout).trim(),
            "installed and imported"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
