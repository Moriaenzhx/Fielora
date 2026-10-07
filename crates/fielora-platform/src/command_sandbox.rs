//! OS-enforced workspace writes and network policy for Agent child commands.
//! Reads remain available to existing runtimes. This is not a VM or a read
//! confidentiality boundary, and is independent from approval routing.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const PROFILE: &str = r#"
(version 1)
(deny default)
(allow file-read*)
(allow process-exec process-fork)
(allow process-info* (target self))
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup
    (global-name "com.apple.system.logger")
    (global-name "com.apple.system.opendirectoryd.libinfo")
    (global-name "com.apple.system.DirectoryService.libinfo_v1"))
(allow file-write* (subpath (param "PROJECT")) (subpath (param "SCRATCH")))
(allow file-write-data file-ioctl (literal "/dev/null"))
"#;

const NETWORK: &str = r#"
(allow network*)
(allow mach-lookup (global-name "com.apple.mDNSResponder"))
"#;

pub fn available() -> bool {
    cfg!(target_os = "macos") && Path::new("/usr/bin/sandbox-exec").is_file()
}

pub struct CommandSandbox {
    project: PathBuf,
    scratch: PathBuf,
    network: bool,
}

impl CommandSandbox {
    pub fn new(project: &Path, network: bool) -> std::io::Result<Self> {
        if !available() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "OS command sandbox unavailable",
            ));
        }
        let project = project.canonicalize()?;
        if !project.is_dir() || project.parent().is_none() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid project sandbox root",
            ));
        }
        let scratch =
            std::env::temp_dir().join(format!("fielora-command-{}", uuid::Uuid::now_v7()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().mode(0o700).create(&scratch)?;
        }
        #[cfg(not(unix))]
        fs::create_dir(&scratch)?;
        let scratch = scratch.canonicalize()?;
        Ok(Self {
            project,
            scratch,
            network,
        })
    }

    pub fn launcher(&self) -> &'static str {
        "/usr/bin/sandbox-exec"
    }

    /// Call after the caller has sanitized the environment. Parameters are
    /// separate argv values, never interpolated into the sandbox language.
    pub fn configure(&self, command: &mut Command, program: &OsStr) {
        let profile = if self.network {
            format!("{PROFILE}\n{NETWORK}")
        } else {
            PROFILE.into()
        };
        command
            .arg("-D")
            .arg(format!("PROJECT={}", self.project.display()))
            .arg("-D")
            .arg(format!("SCRATCH={}", self.scratch.display()))
            .arg("-p")
            .arg(profile)
            .arg(program)
            .env("TMPDIR", &self.scratch)
            .env("TMP", &self.scratch)
            .env("TEMP", &self.scratch)
            .env("XDG_CACHE_HOME", self.scratch.join("cache"))
            .env("PIP_CACHE_DIR", self.scratch.join("pip"))
            .env("npm_config_cache", self.scratch.join("npm"));
    }
}

impl Drop for CommandSandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.scratch);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::os::unix::fs::symlink;

    #[test]
    fn real_macos_sandbox_enforces_writes_links_and_network() {
        let base =
            std::env::temp_dir().join(format!("fielora-sandbox-test-{}", uuid::Uuid::now_v7()));
        let root = base.join("project with spaces (test)");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let sandbox = CommandSandbox::new(&root, false).unwrap();
        let scratch = sandbox.scratch.clone();
        let run = |script: &str| {
            let mut command = Command::new(sandbox.launcher());
            sandbox.configure(&mut command, OsStr::new("/bin/sh"));
            command
                .args(["-c", script])
                .current_dir(&root)
                .output()
                .unwrap()
        };
        let good = run("printf project > allowed.txt; printf temp > \"$TMPDIR/allowed.txt\"");
        assert!(
            good.status.success(),
            "{}",
            String::from_utf8_lossy(&good.stderr)
        );
        assert_eq!(
            fs::read_to_string(root.join("allowed.txt")).unwrap(),
            "project"
        );
        for target in ["../outside/denied.txt", "link/denied.txt"] {
            assert!(!run(&format!("printf denied > {target}")).status.success());
        }
        assert!(!outside.join("denied.txt").exists());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let connect = |sandbox: &CommandSandbox| {
            let mut command = Command::new(sandbox.launcher());
            sandbox.configure(&mut command, OsStr::new("/usr/bin/nc"));
            command
                .args(["-z", "-w", "1", "127.0.0.1", &port])
                .output()
                .unwrap()
        };
        assert!(!connect(&sandbox).status.success());
        let network_sandbox = CommandSandbox::new(&root, true).unwrap();
        let connected = connect(&network_sandbox);
        assert!(
            connected.status.success(),
            "{}",
            String::from_utf8_lossy(&connected.stderr)
        );
        drop(network_sandbox);
        drop(sandbox);
        assert!(!scratch.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
