pub mod fonts;
use fielora_contracts::DeviceId;
use std::ffi::OsString;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;
use thiserror::Error;
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use uuid::{Uuid, Version};

pub const MAX_CREDENTIAL_BYTES: usize = 2048;

const STATIC_CREDENTIAL_TARGET_PREFIX: &str = "Fielora/credential/";

const MAX_MANAGED_PROCESS_ARGUMENTS: usize = 128;
const MAX_MANAGED_PROCESS_ENVIRONMENT: usize = 128;

#[derive(Debug, Clone)]
pub struct ManagedChildConfig {
    pub executable: PathBuf,
    pub arguments: Vec<OsString>,
    pub working_directory: PathBuf,
}

/// One-shot secret environment for an explicitly admitted managed child.
///
/// This value is intentionally neither Clone nor serializable. Debug output
/// exposes only its bounded binding count. The child and its descendants are
/// trusted with these bytes for their process lifetime; this is injection, not
/// a sandbox or a confidentiality boundary against the child.
pub struct ManagedChildSecretEnvironment(Vec<(OsString, SecretBytes)>);

impl std::fmt::Debug for ManagedChildSecretEnvironment {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedChildSecretEnvironment")
            .field("binding_count", &self.0.len())
            .finish()
    }
}

impl ManagedChildSecretEnvironment {
    pub fn new(bindings: Vec<(OsString, SecretBytes)>) -> Result<Self, ManagedChildError> {
        if bindings.len() > MAX_MANAGED_PROCESS_ENVIRONMENT
            || bindings.iter().any(|(key, secret)| {
                key.is_empty()
                    || key.to_string_lossy().contains('=')
                    || key.to_string_lossy().contains('\0')
                    || secret.expose().is_empty()
                    || secret.expose().contains(&0)
                    || std::str::from_utf8(secret.expose()).is_err()
            })
            || bindings.iter().enumerate().any(|(index, (key, _))| {
                bindings[..index].iter().any(|(prior, _)| {
                    prior
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&key.to_string_lossy())
                })
            })
        {
            return Err(ManagedChildError::InvalidConfiguration);
        }
        Ok(Self(bindings))
    }

    pub fn binding_count(&self) -> usize {
        self.0.len()
    }
}

#[derive(Debug)]
pub struct ManagedChildStdio {
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
    pub stderr: ChildStderr,
}

#[derive(Debug, Error)]
pub enum ManagedChildError {
    #[error("managed child configuration is invalid")]
    InvalidConfiguration,
    #[error("managed child I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("managed child did not exit after termination")]
    TerminationTimeout,
    #[error("managed child process handle is unavailable")]
    ProcessHandleUnavailable,
    #[error("Windows Job Object operation failed")]
    JobObject,
}

/// A generic, bounded local child process owned by Fielora.
///
/// The child receives no inherited environment. A Windows Job Object or an
/// independently created Unix process group provides owned descendant cleanup.
pub struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    job: WindowsJob,
    #[cfg(unix)]
    group: UnixProcessGroup,
}

impl std::fmt::Debug for ManagedChild {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedChild")
            .field("id", &self.child.id())
            .finish_non_exhaustive()
    }
}

impl ManagedChild {
    pub fn spawn(
        config: ManagedChildConfig,
    ) -> Result<(Self, ManagedChildStdio), ManagedChildError> {
        Self::spawn_inner(config, None)
    }

    pub fn spawn_with_secret_environment(
        config: ManagedChildConfig,
        secret_environment: ManagedChildSecretEnvironment,
    ) -> Result<(Self, ManagedChildStdio), ManagedChildError> {
        Self::spawn_inner(config, Some(secret_environment))
    }

    fn spawn_inner(
        config: ManagedChildConfig,
        secret_environment: Option<ManagedChildSecretEnvironment>,
    ) -> Result<(Self, ManagedChildStdio), ManagedChildError> {
        if !config.executable.is_absolute()
            || !config.executable.is_file()
            || !config.working_directory.is_absolute()
            || !config.working_directory.is_dir()
            || config.arguments.len() > MAX_MANAGED_PROCESS_ARGUMENTS
        {
            return Err(ManagedChildError::InvalidConfiguration);
        }

        let mut command = Command::new(&config.executable);
        command
            .args(&config.arguments)
            .current_dir(&config.working_directory)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        if let Some(secret_environment) = secret_environment.as_ref() {
            for (key, secret) in &secret_environment.0 {
                let value = std::str::from_utf8(secret.expose())
                    .map_err(|_| ManagedChildError::InvalidConfiguration)?;
                command.env(key, value);
            }
        }
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command.spawn()?;
        #[cfg(unix)]
        let group = UnixProcessGroup::new(
            child
                .id()
                .ok_or(ManagedChildError::ProcessHandleUnavailable)?,
        )?;
        drop(command);
        drop(secret_environment);
        #[cfg(windows)]
        let job = match WindowsJob::assign(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };
        let stdio = ManagedChildStdio {
            stdin: child
                .stdin
                .take()
                .ok_or(ManagedChildError::ProcessHandleUnavailable)?,
            stdout: child
                .stdout
                .take()
                .ok_or(ManagedChildError::ProcessHandleUnavailable)?,
            stderr: child
                .stderr
                .take()
                .ok_or(ManagedChildError::ProcessHandleUnavailable)?,
        };
        Ok((
            Self {
                child,
                #[cfg(windows)]
                job,
                #[cfg(unix)]
                group,
            },
            stdio,
        ))
    }

    pub fn id(&self) -> Option<u32> {
        self.child.id()
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, ManagedChildError> {
        Ok(self.child.try_wait()?)
    }

    pub async fn shutdown(
        &mut self,
        graceful_timeout: Duration,
        termination_timeout: Duration,
    ) -> Result<ExitStatus, ManagedChildError> {
        if let Some(status) = self.child.try_wait()? {
            self.terminate_tree()?;
            return Ok(status);
        }
        if let Ok(result) = tokio::time::timeout(graceful_timeout, self.child.wait()).await {
            self.terminate_tree()?;
            return Ok(result?);
        }
        self.terminate_tree()?;
        match tokio::time::timeout(termination_timeout, self.child.wait()).await {
            Ok(result) => Ok(result?),
            Err(_) => Err(ManagedChildError::TerminationTimeout),
        }
    }

    pub fn terminate_tree(&mut self) -> Result<(), ManagedChildError> {
        #[cfg(windows)]
        {
            self.job.terminate()
        }
        #[cfg(unix)]
        {
            self.group.terminate().map_err(ManagedChildError::Io)
        }
    }
}

/// Owns a child launched with `process_group(0)`. This is lifecycle cleanup,
/// not a sandbox: a cooperating group cannot contain a process that calls setsid.
#[cfg(unix)]
pub struct UnixProcessGroup {
    pid: i32,
    terminated: std::cell::Cell<bool>,
}

#[cfg(unix)]
impl UnixProcessGroup {
    pub fn new(child_pid: u32) -> std::io::Result<Self> {
        let pid = i32::try_from(child_pid)
            .ok()
            .filter(|pid| *pid > 1)
            .ok_or_else(|| std::io::Error::other("invalid child process group"))?;
        Ok(Self {
            pid,
            terminated: std::cell::Cell::new(false),
        })
    }

    pub fn terminate(&self) -> std::io::Result<()> {
        if self.terminated.get() {
            return Ok(());
        }
        // Negative PID addresses only this independently created child group.
        if unsafe { libc::kill(-self.pid, libc::SIGKILL) } == 0 {
            self.terminated.set(true);
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            self.terminated.set(true);
            Ok(())
        } else {
            Err(error)
        }
    }
}

#[cfg(unix)]
impl Drop for UnixProcessGroup {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.terminate_tree();
            let _ = self.child.start_kill();
        }
    }
}

#[cfg(windows)]
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for WindowsJob {}

#[cfg(windows)]
impl WindowsJob {
    fn assign(child: &Child) -> Result<Self, ManagedChildError> {
        use std::ptr::null;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };
        let job = unsafe { CreateJobObjectW(null(), null()) };
        if job.is_null() {
            return Err(ManagedChildError::JobObject);
        }
        let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &information as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        let process = child
            .raw_handle()
            .ok_or(ManagedChildError::ProcessHandleUnavailable)?
            as windows_sys::Win32::Foundation::HANDLE;
        if configured == 0 || unsafe { AssignProcessToJobObject(job, process) } == 0 {
            unsafe { windows_sys::Win32::Foundation::CloseHandle(job) };
            return Err(ManagedChildError::JobObject);
        }
        Ok(Self(job))
    }

    fn terminate(&self) -> Result<(), ManagedChildError> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        if unsafe { TerminateJobObject(self.0, 1) } == 0 {
            Err(ManagedChildError::JobObject)
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

pub struct SecretBytes(Vec<u8>);

impl std::fmt::Debug for SecretBytes {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretBytes([REDACTED])")
    }
}

impl SecretBytes {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }
    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for SecretBytes {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

/// Stable, non-secret identity for one generic static credential.
///
/// The opaque reference is safe to compare and persist in future trusted
/// configuration, but it never contains or derives from the credential bytes.
/// Existing model Provider targets remain separate and unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CredentialRef(String);

impl CredentialRef {
    pub fn new() -> Self {
        Self(format!("cred_{}", Uuid::now_v7()))
    }

    pub fn parse(value: impl Into<String>) -> Result<Self, CredentialError> {
        let value = value.into();
        let uuid = value
            .strip_prefix("cred_")
            .and_then(|value| Uuid::parse_str(value).ok())
            .filter(|uuid| uuid.get_version() == Some(Version::SortRand))
            .ok_or(CredentialError::InvalidReference)?;
        if value != format!("cred_{uuid}") {
            return Err(CredentialError::InvalidReference);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn target_name(&self) -> String {
        format!("{STATIC_CREDENTIAL_TARGET_PREFIX}{}", self.0)
    }
}

impl Default for CredentialRef {
    fn default() -> Self {
        Self::new()
    }
}

/// Return whether an address is eligible for a direct public-Internet
/// connection. Private, loopback, link-local, multicast, unspecified,
/// documentation, benchmarking, transition, and other special-purpose ranges
/// are fail-closed.
pub fn is_public_internet_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || octets[0] == 0
                || octets[0] >= 224
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] <= 2)
                || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113))
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_internet_ip(IpAddr::V4(v4));
            }
            let segments = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
                || segments[..6].iter().all(|segment| *segment == 0)
                || (segments[0] & 0xffc0) == 0xfec0
                || (segments[0] == 0x0100
                    && segments[1] == 0
                    && segments[2] == 0
                    && segments[3] == 0)
                || (segments[0] & 0xfff0) == 0x3ff0
                || (segments[0] == 0x2001
                    && (matches!(segments[1], 0x0000 | 0x0002 | 0x000d | 0x0db8)
                        || (segments[1] & 0xfff0) == 0x0010
                        || (segments[1] & 0xfff0) == 0x0020))
                || segments[0] == 0x2002)
        }
    }
}

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("credential reference is invalid")]
    InvalidReference,
    #[error("credential not found")]
    NotFound,
    #[error("credential is empty or exceeds the 2048-byte bound")]
    InvalidSize,
    #[error("credential manager operation failed")]
    Platform,
}

pub trait CredentialStore: Send + Sync {
    fn store(&self, target: &str, secret: SecretBytes) -> Result<(), CredentialError>;
    fn read(&self, target: &str) -> Result<SecretBytes, CredentialError>;
    fn delete(&self, target: &str) -> Result<(), CredentialError>;
    fn exists(&self, target: &str) -> bool {
        self.read(target).is_ok()
    }

    fn put_static(
        &self,
        credential_ref: &CredentialRef,
        secret: SecretBytes,
    ) -> Result<(), CredentialError> {
        self.store(&credential_ref.target_name(), secret)
    }

    fn resolve_static(
        &self,
        credential_ref: &CredentialRef,
    ) -> Result<SecretBytes, CredentialError> {
        self.read(&credential_ref.target_name())
    }

    fn static_exists(&self, credential_ref: &CredentialRef) -> bool;

    fn delete_static(&self, credential_ref: &CredentialRef) -> Result<(), CredentialError> {
        self.delete(&credential_ref.target_name())
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemCredentialStore;

// Preserve source compatibility for existing integrations.
pub use SystemCredentialStore as WindowsCredentialStore;

#[cfg(windows)]
impl CredentialStore for WindowsCredentialStore {
    fn store(&self, target: &str, secret: SecretBytes) -> Result<(), CredentialError> {
        use std::ptr::null_mut;
        use windows_sys::Win32::Security::Credentials::{
            CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredWriteW,
        };
        if secret.expose().is_empty() || secret.expose().len() > MAX_CREDENTIAL_BYTES {
            return Err(CredentialError::InvalidSize);
        }
        let mut target = wide(target);
        let mut user = wide("Fielora");
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            Comment: null_mut(),
            LastWritten: unsafe { std::mem::zeroed() },
            CredentialBlobSize: secret.expose().len() as u32,
            CredentialBlob: secret.expose().as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: null_mut(),
            TargetAlias: null_mut(),
            UserName: user.as_mut_ptr(),
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err(CredentialError::Platform)
        } else {
            Ok(())
        }
    }

    fn read(&self, target: &str) -> Result<SecretBytes, CredentialError> {
        use std::ptr::null_mut;
        use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
        use windows_sys::Win32::Security::Credentials::{
            CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
        };
        let target = wide(target);
        let mut raw: *mut CREDENTIALW = null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Err(CredentialError::NotFound)
            } else {
                Err(CredentialError::Platform)
            };
        }
        let credential = unsafe { &*raw };
        let bytes = unsafe {
            std::slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
        }
        .to_vec();
        unsafe { CredFree(raw as *const _) };
        Ok(SecretBytes::new(bytes))
    }

    fn delete(&self, target: &str) -> Result<(), CredentialError> {
        use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
        use windows_sys::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW};
        let target = wide(target);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            Err(CredentialError::Platform)
        } else {
            Ok(())
        }
    }

    fn static_exists(&self, credential_ref: &CredentialRef) -> bool {
        use std::ptr::null_mut;
        use windows_sys::Win32::Security::Credentials::{
            CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
        };
        let target = wide(&credential_ref.target_name());
        let mut raw: *mut CREDENTIALW = null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            return false;
        }
        // Existence admission deliberately does not inspect or copy the blob.
        unsafe { CredFree(raw as *const _) };
        true
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
impl CredentialStore for WindowsCredentialStore {
    fn store(&self, _: &str, _: SecretBytes) -> Result<(), CredentialError> {
        Err(CredentialError::Platform)
    }
    fn read(&self, _: &str) -> Result<SecretBytes, CredentialError> {
        Err(CredentialError::Platform)
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        Err(CredentialError::Platform)
    }
    fn static_exists(&self, _: &CredentialRef) -> bool {
        false
    }
}

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Fielora";

#[cfg(target_os = "macos")]
fn keychain_error(error: security_framework::base::Error) -> CredentialError {
    if error.code() == security_framework_sys::base::errSecItemNotFound {
        CredentialError::NotFound
    } else {
        CredentialError::Platform
    }
}

#[cfg(target_os = "macos")]
impl CredentialStore for SystemCredentialStore {
    fn store(&self, target: &str, secret: SecretBytes) -> Result<(), CredentialError> {
        if secret.expose().is_empty() || secret.expose().len() > MAX_CREDENTIAL_BYTES {
            return Err(CredentialError::InvalidSize);
        }
        security_framework::passwords::set_generic_password(
            KEYCHAIN_SERVICE,
            target,
            secret.expose(),
        )
        .map_err(keychain_error)
    }

    fn read(&self, target: &str) -> Result<SecretBytes, CredentialError> {
        use security_framework::passwords::{PasswordOptions, generic_password};
        generic_password(PasswordOptions::new_generic_password(
            KEYCHAIN_SERVICE,
            target,
        ))
        .map(SecretBytes::new)
        .map_err(keychain_error)
    }

    fn delete(&self, target: &str) -> Result<(), CredentialError> {
        match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, target)
            .map_err(keychain_error)
        {
            Ok(()) | Err(CredentialError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn exists(&self, target: &str) -> bool {
        use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
        // Metadata admission never requests the password data.
        ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(KEYCHAIN_SERVICE)
            .account(target)
            .load_attributes(true)
            .load_data(false)
            .limit(Limit::Max(1))
            .search()
            .is_ok()
    }

    fn static_exists(&self, credential_ref: &CredentialRef) -> bool {
        self.exists(&credential_ref.target_name())
    }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("platform application data directory is unavailable")]
    LocalAppDataUnavailable,
    #[error("platform I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("stored device identity is not a canonical UUIDv7")]
    InvalidDeviceIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformPaths {
    pub base_dir: PathBuf,
    pub data_dir: PathBuf,
    pub library_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub config_dir: PathBuf,
    pub database: PathBuf,
    pub core_log: PathBuf,
    pub device_identity: PathBuf,
}

impl PlatformPaths {
    pub fn resolve(allow_development_override: bool) -> Result<Self, PlatformError> {
        let root = if allow_development_override {
            match std::env::var_os("FIELORA_DATA_DIR") {
                Some(root) => PathBuf::from(root),
                None => resolve_local_app_data_root()?,
            }
        } else {
            resolve_local_app_data_root()?
        };
        let data_root = std::env::var_os("FIELORA_MANAGED_DATA_ROOT").map(PathBuf::from);
        let library_root = std::env::var_os("FIELORA_MANAGED_LIBRARY_ROOT").map(PathBuf::from);
        let cache_root = std::env::var_os("FIELORA_MANAGED_CACHE_ROOT").map(PathBuf::from);
        Self::from_storage_roots(
            root.clone(),
            data_root.unwrap_or_else(|| root.join("data")),
            library_root.unwrap_or_else(|| root.join("library")),
            cache_root.unwrap_or_else(|| root.join("cache")),
        )
    }

    pub fn from_root(root: PathBuf) -> Result<Self, PlatformError> {
        Self::from_storage_roots(
            root.clone(),
            root.join("data"),
            root.join("library"),
            root.join("cache"),
        )
    }

    pub fn from_storage_roots(
        root: PathBuf,
        data_dir: PathBuf,
        library_dir: PathBuf,
        cache_dir: PathBuf,
    ) -> Result<Self, PlatformError> {
        let runtime_dir = root.join("runtime");
        let logs_dir = root.join("logs");
        let config_dir = root.join("config");
        for directory in [
            &data_dir,
            &library_dir,
            &cache_dir,
            &runtime_dir,
            &logs_dir,
            &config_dir,
        ] {
            fs::create_dir_all(directory)?;
        }
        Ok(Self {
            base_dir: root,
            database: data_dir.join("fielora.db"),
            core_log: logs_dir.join("fielora-core.log"),
            device_identity: config_dir.join("device-id"),
            data_dir,
            library_dir,
            cache_dir,
            runtime_dir,
            logs_dir,
            config_dir,
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn resolve_local_app_data_root() -> Result<PathBuf, PlatformError> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Fielora"))
        .ok_or(PlatformError::LocalAppDataUnavailable)
}

#[cfg(target_os = "macos")]
fn resolve_local_app_data_root() -> Result<PathBuf, PlatformError> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join("Library/Application Support/Fielora"))
        .ok_or(PlatformError::LocalAppDataUnavailable)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceIdentity {
    pub id: DeviceId,
    pub name: String,
    pub platform: String,
    pub architecture: String,
}

impl DeviceIdentity {
    pub fn load_or_create(path: &Path) -> Result<Self, PlatformError> {
        let id = if path.exists() {
            let value = fs::read_to_string(path)?;
            let value = value.trim();
            let uuid = Uuid::parse_str(value).map_err(|_| PlatformError::InvalidDeviceIdentity)?;
            if uuid.get_version() != Some(Version::SortRand) || uuid.to_string() != value {
                return Err(PlatformError::InvalidDeviceIdentity);
            }
            DeviceId::new(value)
        } else {
            let id = DeviceId::new(Uuid::now_v7().to_string());
            fs::write(path, format!("{}\n", id.0))?;
            id
        };
        Ok(Self {
            id,
            name: "This device".into(),
            platform: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryCredentialStore {
        values: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl CredentialStore for MemoryCredentialStore {
        fn store(&self, target: &str, secret: SecretBytes) -> Result<(), CredentialError> {
            if secret.expose().is_empty() || secret.expose().len() > MAX_CREDENTIAL_BYTES {
                return Err(CredentialError::InvalidSize);
            }
            self.values
                .lock()
                .unwrap()
                .insert(target.to_owned(), secret.expose().to_vec());
            Ok(())
        }

        fn read(&self, target: &str) -> Result<SecretBytes, CredentialError> {
            self.values
                .lock()
                .unwrap()
                .get(target)
                .cloned()
                .map(SecretBytes::new)
                .ok_or(CredentialError::NotFound)
        }

        fn delete(&self, target: &str) -> Result<(), CredentialError> {
            self.values.lock().unwrap().remove(target);
            Ok(())
        }

        fn static_exists(&self, credential_ref: &CredentialRef) -> bool {
            self.values
                .lock()
                .unwrap()
                .contains_key(&credential_ref.target_name())
        }
    }

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("fielora-platform-{}", Uuid::now_v7()))
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn managed_child_shutdown_closes_descendant_pipes() {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
        let (mut child, stdio) = ManagedChild::spawn(ManagedChildConfig {
            executable: PathBuf::from("/bin/sh"),
            arguments: vec!["-c".into(), "/bin/sleep 30 & echo ready; wait".into()],
            working_directory: std::env::temp_dir(),
        })
        .unwrap();
        let mut output = BufReader::new(stdio.stdout);
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(3), output.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(line.trim(), "ready");
        child
            .shutdown(Duration::from_millis(10), Duration::from_secs(2))
            .await
            .unwrap();
        let mut tail = String::new();
        tokio::time::timeout(Duration::from_secs(2), output.read_to_string(&mut tail))
            .await
            .expect("descendant retained the pipe")
            .unwrap();
    }

    #[test]
    fn managed_child_secret_environment_is_bounded_and_debug_redacted() {
        let sentinel = "managed-child-secret-sentinel";
        let environment = ManagedChildSecretEnvironment::new(vec![(
            OsString::from("FIELORA_TEST_SECRET"),
            SecretBytes::new(sentinel.as_bytes().to_vec()),
        )])
        .unwrap();
        let debug = format!("{environment:?}");
        assert_eq!(environment.binding_count(), 1);
        assert!(!debug.contains(sentinel));
        assert!(!debug.contains("FIELORA_TEST_SECRET"));
        assert!(
            ManagedChildSecretEnvironment::new(vec![
                (OsString::from("TOKEN"), SecretBytes::new(b"one".to_vec())),
                (OsString::from("token"), SecretBytes::new(b"two".to_vec())),
            ])
            .is_err()
        );
    }

    #[test]
    fn device_identity_is_installation_local_and_stable() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let first = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let second = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        assert_eq!(first.id, second.id);
        assert!(!first.id.0.contains('\\'));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn storage_roots_are_independent_and_database_stays_in_data_root() {
        let root = temporary_root();
        let data = root.join("durable");
        let library = root.join("large-library");
        let cache = root.join("disposable");
        let paths = PlatformPaths::from_storage_roots(
            root.clone(),
            data.clone(),
            library.clone(),
            cache.clone(),
        )
        .unwrap();
        assert_eq!(paths.data_dir, data);
        assert_eq!(paths.database, data.join("fielora.db"));
        assert_eq!(paths.library_dir, library);
        assert_eq!(paths.cache_dir, cache);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generic_static_credentials_use_an_opaque_isolated_namespace() {
        let store = MemoryCredentialStore::default();
        let credential_ref = CredentialRef::new();
        let parsed = CredentialRef::parse(credential_ref.as_str()).unwrap();
        assert_eq!(parsed, credential_ref);
        assert!(credential_ref.as_str().starts_with("cred_"));
        assert_eq!(
            credential_ref.target_name(),
            format!("Fielora/credential/{}", credential_ref.as_str())
        );
        assert!(
            !credential_ref
                .target_name()
                .starts_with("Fielora/provider/")
        );
        for invalid in [
            "provider-name",
            "cred_not-a-uuid",
            "Fielora/provider/0195f5f5-1111-7111-8111-111111111111",
            "cred_0195f5f5-1111-4111-8111-111111111111",
        ] {
            assert!(matches!(
                CredentialRef::parse(invalid),
                Err(CredentialError::InvalidReference)
            ));
        }

        store
            .put_static(&credential_ref, SecretBytes::new(b"version-one".to_vec()))
            .unwrap();
        assert!(store.static_exists(&credential_ref));
        assert_eq!(
            store.resolve_static(&credential_ref).unwrap().expose(),
            b"version-one"
        );
        store
            .put_static(&credential_ref, SecretBytes::new(b"version-two".to_vec()))
            .unwrap();
        assert_eq!(
            store.resolve_static(&credential_ref).unwrap().expose(),
            b"version-two"
        );
        store.delete_static(&credential_ref).unwrap();
        assert!(!store.static_exists(&credential_ref));
        assert!(matches!(
            store.resolve_static(&credential_ref),
            Err(CredentialError::NotFound)
        ));
        assert_eq!(
            format!("{:?}", SecretBytes::new(b"never-print-me".to_vec())),
            "SecretBytes([REDACTED])"
        );
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn system_static_credential_round_trip_replaces_and_deletes() {
        struct Cleanup(CredentialRef);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = WindowsCredentialStore.delete_static(&self.0);
            }
        }

        let credential_ref = CredentialRef::new();
        let _cleanup = Cleanup(credential_ref.clone());
        let first = format!("first-{}", Uuid::now_v7());
        let second = format!("second-{}", Uuid::now_v7());
        WindowsCredentialStore
            .put_static(&credential_ref, SecretBytes::new(first.as_bytes().to_vec()))
            .unwrap();
        assert!(WindowsCredentialStore.static_exists(&credential_ref));
        assert_eq!(
            WindowsCredentialStore
                .resolve_static(&credential_ref)
                .unwrap()
                .expose(),
            first.as_bytes()
        );
        WindowsCredentialStore
            .put_static(
                &credential_ref,
                SecretBytes::new(second.as_bytes().to_vec()),
            )
            .unwrap();
        assert_eq!(
            WindowsCredentialStore
                .resolve_static(&credential_ref)
                .unwrap()
                .expose(),
            second.as_bytes()
        );
        WindowsCredentialStore
            .delete_static(&credential_ref)
            .unwrap();
        assert!(!WindowsCredentialStore.static_exists(&credential_ref));
    }
}
