//! Trusted configuration over the existing provider and credential seams.
use fielora_agent::web::{
    BRAVE_SEARCH_PROVIDER_ID, EXA_SEARCH_PROVIDER_ID, SEARXNG_SEARCH_PROVIDER_ID, WEB_PROVIDER_ID,
    WebToolProvider, validate_search_endpoint,
};
use fielora_agent::{
    CommandCancellation, StaticCredentialBinding, StaticCredentialMediator,
    StaticCredentialRequirement, ToolProvider, ToolProviderError,
};
use fielora_contracts::{
    UpdateWebSearchConfigRequest, WebSearchConfigView, WebSearchProbeView, WebSearchProviderView,
};
use fielora_field::DomainError;
use fielora_platform::{CredentialRef, CredentialStore, SecretBytes};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

const EXA_CREDENTIAL_REF: &str = "cred_01a12e10-0000-7000-8000-000000000001";
const BRAVE_CREDENTIAL_REF: &str = "cred_01a12e10-0000-7000-8000-000000000002";
const CONFIG_LIMIT: u64 = 8192;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    version: u32,
    provider_id: String,
    searxng_endpoint: Option<String>,
}
impl Default for Selection {
    fn default() -> Self {
        Self {
            version: 1,
            provider_id: EXA_SEARCH_PROVIDER_ID.into(),
            searxng_endpoint: None,
        }
    }
}
struct State {
    selection: Selection,
    error: Option<String>,
    custom: Option<Arc<WebToolProvider>>,
}
pub struct WebSearchService {
    credentials: Arc<dyn CredentialStore>,
    config_path: PathBuf,
    state: Mutex<State>,
    keyless: Arc<WebToolProvider>,
    keyed: Arc<WebToolProvider>,
    brave: Arc<WebToolProvider>,
    fetch_only: Arc<WebToolProvider>,
    probe_busy: AtomicBool,
    probe_cancellation: CommandCancellation,
}
fn invalid(code: &str) -> DomainError {
    DomainError::Validation(code.into())
}
fn valid_provider(provider: &str) -> bool {
    matches!(
        provider,
        EXA_SEARCH_PROVIDER_ID | BRAVE_SEARCH_PROVIDER_ID | SEARXNG_SEARCH_PROVIDER_ID
    )
}
fn slot(provider: &str) -> Result<(CredentialRef, StaticCredentialRequirement), DomainError> {
    let (reference, kind) = match provider {
        EXA_SEARCH_PROVIDER_ID => (EXA_CREDENTIAL_REF, "api_key"),
        BRAVE_SEARCH_PROVIDER_ID => (BRAVE_CREDENTIAL_REF, "subscription_token"),
        _ => return Err(invalid("WEB_SEARCH_PROVIDER_INVALID")),
    };
    Ok((
        CredentialRef::parse(reference).expect("reserved credential reference"),
        StaticCredentialRequirement::new(provider, kind).expect("static requirement"),
    ))
}
impl WebSearchService {
    pub fn new(
        credentials: Arc<dyn CredentialStore>,
        config_path: PathBuf,
    ) -> Result<Self, DomainError> {
        let loaded = (|| {
            let file = match fs::File::open(&config_path) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(Selection::default());
                }
                Err(_) => return Err(()),
            };
            let mut bytes = Vec::new();
            file.take(CONFIG_LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ())?;
            if bytes.len() as u64 > CONFIG_LIMIT {
                return Err(());
            }
            let selection: Selection = serde_json::from_slice(&bytes).map_err(|_| ())?;
            if selection.version != 1 || !valid_provider(&selection.provider_id) {
                return Err(());
            }
            if let Some(endpoint) = &selection.searxng_endpoint {
                validate_search_endpoint(endpoint).map_err(|_| ())?;
            }
            Ok(selection)
        })();
        let (selection, error) = match loaded {
            Ok(selection) => (selection, None),
            Err(()) => (
                Selection::default(),
                Some("WEB_SEARCH_CONFIG_INVALID".into()),
            ),
        };
        let wrap = |result: Result<WebToolProvider, fielora_agent::web::WebFailure>| {
            result
                .map(Arc::new)
                .map_err(|_| invalid("WEB_SEARCH_UNAVAILABLE"))
        };
        let custom = selection
            .searxng_endpoint
            .as_deref()
            .map(WebToolProvider::with_searxng)
            .transpose()
            .map_err(|_| invalid("WEB_SEARCH_UNAVAILABLE"))?
            .map(Arc::new);
        Ok(Self {
            credentials,
            config_path,
            state: Mutex::new(State {
                selection,
                error,
                custom,
            }),
            keyless: wrap(if crate::agent_web_fixture::enabled() {
                Ok(crate::agent_web_fixture::provider(false))
            } else {
                WebToolProvider::with_exa(false)
            })?,
            keyed: wrap(if crate::agent_web_fixture::enabled() {
                Ok(crate::agent_web_fixture::provider(true))
            } else {
                WebToolProvider::with_exa(true)
            })?,
            brave: wrap(if crate::agent_web_fixture::enabled() {
                Ok(crate::agent_web_fixture::brave_provider())
            } else {
                WebToolProvider::with_brave()
            })?,
            fetch_only: wrap(WebToolProvider::public_fetch())?,
            probe_busy: AtomicBool::new(false),
            probe_cancellation: CommandCancellation::default(),
        })
    }
    pub fn bindings() -> Vec<StaticCredentialBinding> {
        [EXA_SEARCH_PROVIDER_ID, BRAVE_SEARCH_PROVIDER_ID]
            .map(|provider| {
                let (reference, requirement) = slot(provider).unwrap();
                StaticCredentialBinding::new(WEB_PROVIDER_ID, requirement, reference)
                    .expect("static binding")
            })
            .into()
    }
    fn has_key(&self, provider: &str) -> bool {
        slot(provider).is_ok_and(|(reference, _)| self.credentials.static_exists(&reference))
    }
    /// One immutable Arc supplies credential requirement and execution. A switch
    /// changes the next dispatch, never an in-flight credential's destination.
    pub fn provider(&self) -> Arc<WebToolProvider> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.error.is_some() {
            return self.fetch_only.clone();
        }
        match state.selection.provider_id.as_str() {
            EXA_SEARCH_PROVIDER_ID if self.has_key(EXA_SEARCH_PROVIDER_ID) => self.keyed.clone(),
            EXA_SEARCH_PROVIDER_ID => self.keyless.clone(),
            BRAVE_SEARCH_PROVIDER_ID => self.brave.clone(),
            SEARXNG_SEARCH_PROVIDER_ID => state
                .custom
                .clone()
                .unwrap_or_else(|| self.fetch_only.clone()),
            _ => self.fetch_only.clone(),
        }
    }
    pub fn status(&self) -> WebSearchConfigView {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let providers = vec![
            WebSearchProviderView {
                provider_id: EXA_SEARCH_PROVIDER_ID.into(),
                display_name: "Exa".into(),
                endpoint: Some("https://mcp.exa.ai/mcp".into()),
                credential_mode: "OPTIONAL".into(),
                credential_present: self.has_key(EXA_SEARCH_PROVIDER_ID),
                available: true,
            },
            WebSearchProviderView {
                provider_id: BRAVE_SEARCH_PROVIDER_ID.into(),
                display_name: "Brave Search".into(),
                endpoint: Some("https://api.search.brave.com/res/v1/web/search".into()),
                credential_mode: "REQUIRED".into(),
                credential_present: self.has_key(BRAVE_SEARCH_PROVIDER_ID),
                available: self.has_key(BRAVE_SEARCH_PROVIDER_ID),
            },
            WebSearchProviderView {
                provider_id: SEARXNG_SEARCH_PROVIDER_ID.into(),
                display_name: "SearXNG / 自建兼容服务".into(),
                endpoint: state.selection.searxng_endpoint.clone(),
                credential_mode: "NONE".into(),
                credential_present: false,
                available: state.custom.is_some(),
            },
        ];
        let selected = providers
            .iter()
            .find(|p| p.provider_id == state.selection.provider_id)
            .unwrap();
        WebSearchConfigView {
            provider_id: state.selection.provider_id.clone(),
            available: state.error.is_none() && selected.available,
            credential_present: selected.credential_present,
            providers,
            config_error: state.error.clone(),
        }
    }
    pub fn update(
        &self,
        request: UpdateWebSearchConfigRequest,
    ) -> Result<WebSearchConfigView, DomainError> {
        if !valid_provider(&request.provider_id) {
            return Err(invalid("WEB_SEARCH_PROVIDER_INVALID"));
        }
        let endpoint = if request.provider_id == SEARXNG_SEARCH_PROVIDER_ID {
            Some(
                validate_search_endpoint(request.endpoint.as_deref().unwrap_or(""))
                    .map_err(|_| invalid("WEB_SEARCH_ENDPOINT_INVALID"))?,
            )
        } else {
            if request.endpoint.is_some() {
                return Err(invalid("WEB_SEARCH_ENDPOINT_INVALID"));
            }
            None
        };
        let custom = endpoint
            .as_deref()
            .map(WebToolProvider::with_searxng)
            .transpose()
            .map_err(|_| invalid("WEB_SEARCH_UNAVAILABLE"))?
            .map(Arc::new);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let selection = Selection {
            version: 1,
            provider_id: request.provider_id,
            searxng_endpoint: endpoint
                .clone()
                .or_else(|| state.selection.searxng_endpoint.clone()),
        };
        self.persist(&selection)?;
        state.selection = selection;
        state.error = None;
        if endpoint.is_some() {
            state.custom = custom;
        }
        drop(state);
        Ok(self.status())
    }
    fn persist(&self, selection: &Selection) -> Result<(), DomainError> {
        let parent = self
            .config_path
            .parent()
            .ok_or_else(|| invalid("WEB_SEARCH_CONFIG_IO_FAILED"))?;
        fs::create_dir_all(parent).map_err(|_| invalid("WEB_SEARCH_CONFIG_IO_FAILED"))?;
        let bytes = serde_json::to_vec_pretty(selection)
            .map_err(|_| invalid("WEB_SEARCH_CONFIG_IO_FAILED"))?;
        if bytes.len() as u64 > CONFIG_LIMIT {
            return Err(invalid("WEB_SEARCH_CONFIG_INVALID"));
        }
        let suffix = uuid::Uuid::now_v7();
        let temp = self.config_path.with_extension(format!("tmp-{suffix}"));
        let backup = self
            .config_path
            .with_extension(format!("previous-{suffix}"));
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            let previous = self.config_path.exists();
            if previous {
                fs::rename(&self.config_path, &backup)?;
            }
            if let Err(error) = fs::rename(&temp, &self.config_path) {
                if previous {
                    let _ = fs::rename(&backup, &self.config_path);
                }
                return Err(error);
            }
            if previous {
                let _ = fs::remove_file(&backup);
            }
            Ok::<_, std::io::Error>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result.map_err(|_| invalid("WEB_SEARCH_CONFIG_IO_FAILED"))
    }
    pub fn store_credential(
        &self,
        provider: Option<&str>,
        secret: String,
    ) -> Result<WebSearchConfigView, DomainError> {
        let (reference, _) = slot(provider.unwrap_or(EXA_SEARCH_PROVIDER_ID))?;
        let secret = secret.trim();
        if secret.is_empty() || secret.len() > 2048 || !secret.bytes().all(|b| b.is_ascii_graphic())
        {
            return Err(invalid("WEB_SEARCH_CREDENTIAL_INVALID"));
        }
        self.credentials
            .store(
                &reference.target_name(),
                SecretBytes::new(secret.as_bytes().to_vec()),
            )
            .map_err(|_| invalid("CREDENTIAL_STORE_FAILED"))?;
        Ok(self.status())
    }
    pub fn delete_credential(
        &self,
        provider: Option<&str>,
    ) -> Result<WebSearchConfigView, DomainError> {
        let (reference, _) = slot(provider.unwrap_or(EXA_SEARCH_PROVIDER_ID))?;
        self.credentials
            .delete(&reference.target_name())
            .map_err(|_| invalid("CREDENTIAL_DELETE_FAILED"))?;
        Ok(self.status())
    }
    pub fn probe(&self) -> WebSearchProbeView {
        let config = self.status();
        let mut view = WebSearchProbeView {
            provider_id: config.provider_id,
            success: false,
            error_code: None,
            result_count: 0,
            sources: vec![],
            checked_at: crate::now_ms(),
        };
        if let Some(error) = config.config_error {
            view.error_code = Some(error);
            return view;
        }
        if self.probe_busy.swap(true, Ordering::SeqCst) {
            view.error_code = Some("WEB_SEARCH_TEST_BUSY".into());
            return view;
        }
        let result = (|| {
            let provider = self.provider();
            let credential = provider
                .required_static_credential("search")
                .map(|requirement| {
                    StaticCredentialMediator::new(self.credentials.clone(), &Self::bindings())
                        .map_err(|_| ToolProviderError::Unavailable)?
                        .resolve_exact(WEB_PROVIDER_ID, &requirement)
                })
                .transpose()?;
            provider.execute_with_static_credential(
                "search",
                &json!({"query":"Rust programming language official documentation","count":2}),
                credential,
                &self.probe_cancellation,
            )
        })();
        match result {
            Ok(execution) => {
                if let Some(provider) = execution.receipt["provider_id"].as_str() {
                    view.provider_id = provider.into();
                }
                match serde_json::from_value(execution.receipt["sources"].clone()) {
                    Ok(sources) => {
                        view.success = true;
                        view.sources = sources;
                        view.result_count = view.sources.len() as u32;
                    }
                    Err(_) => view.error_code = Some("AGENT_TOOL_RESPONSE_MALFORMED".into()),
                }
            }
            Err(ToolProviderError::ClassifiedFailure(kind)) => {
                view.error_code = Some(kind.code().into())
            }
            Err(_) => view.error_code = Some("WEB_SEARCH_UNAVAILABLE".into()),
        }
        self.probe_busy.store(false, Ordering::SeqCst);
        view
    }
    pub fn cancel_probe(&self) {
        self.probe_cancellation.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_platform::CredentialError;
    use std::collections::HashMap;
    #[derive(Default)]
    struct Keys(Mutex<HashMap<String, Vec<u8>>>);
    impl CredentialStore for Keys {
        fn store(&self, target: &str, value: SecretBytes) -> Result<(), CredentialError> {
            self.0
                .lock()
                .unwrap()
                .insert(target.into(), value.expose().to_vec());
            Ok(())
        }
        fn read(&self, target: &str) -> Result<SecretBytes, CredentialError> {
            self.0
                .lock()
                .unwrap()
                .get(target)
                .cloned()
                .map(SecretBytes::new)
                .ok_or(CredentialError::NotFound)
        }
        fn delete(&self, target: &str) -> Result<(), CredentialError> {
            self.0.lock().unwrap().remove(target);
            Ok(())
        }
        fn static_exists(&self, reference: &CredentialRef) -> bool {
            self.0
                .lock()
                .unwrap()
                .contains_key(&reference.target_name())
        }
    }
    fn setup() -> (PathBuf, Arc<Keys>, WebSearchService) {
        let root =
            std::env::temp_dir().join(format!("fielora-search-config-{}", uuid::Uuid::now_v7()));
        let keys = Arc::new(Keys::default());
        let service = WebSearchService::new(keys.clone(), root.join("web-search.json")).unwrap();
        (root, keys, service)
    }
    #[test]
    fn settings_survive_restart_without_mixing_credentials_or_switching_old_dispatch() {
        let (root, keys, service) = setup();
        assert_eq!(service.status().providers.len(), 3);
        service
            .store_credential(None, "exa-private-sentinel".into())
            .unwrap();
        let exa_inflight = service.provider();
        service
            .store_credential(
                Some(BRAVE_SEARCH_PROVIDER_ID),
                "brave-private-sentinel".into(),
            )
            .unwrap();
        service
            .update(UpdateWebSearchConfigRequest {
                provider_id: BRAVE_SEARCH_PROVIDER_ID.into(),
                endpoint: None,
            })
            .unwrap();
        let brave_inflight = service.provider();
        let mediator =
            StaticCredentialMediator::new(keys.clone(), &WebSearchService::bindings()).unwrap();
        assert_eq!(
            mediator
                .resolve_exact(
                    WEB_PROVIDER_ID,
                    &exa_inflight.required_static_credential("search").unwrap()
                )
                .unwrap()
                .expose(),
            b"exa-private-sentinel"
        );
        assert_eq!(
            mediator
                .resolve_exact(
                    WEB_PROVIDER_ID,
                    &brave_inflight.required_static_credential("search").unwrap()
                )
                .unwrap()
                .expose(),
            b"brave-private-sentinel"
        );
        let stored = fs::read_to_string(root.join("web-search.json")).unwrap();
        assert!(!stored.contains("sentinel"));
        let restarted = WebSearchService::new(keys.clone(), root.join("web-search.json")).unwrap();
        assert_eq!(restarted.status().provider_id, BRAVE_SEARCH_PROVIDER_ID);
        restarted
            .delete_credential(Some(BRAVE_SEARCH_PROVIDER_ID))
            .unwrap();
        assert!(!restarted.status().available);
        assert!(restarted.status().providers[0].credential_present);
        assert_eq!(
            restarted.probe().error_code.as_deref(),
            Some("AGENT_TOOL_CREDENTIAL_MISSING")
        );
        assert!(
            restarted
                .update(UpdateWebSearchConfigRequest {
                    provider_id: "unknown".into(),
                    endpoint: None
                })
                .is_err()
        );
        assert_eq!(restarted.status().provider_id, BRAVE_SEARCH_PROVIDER_ID);
        assert!(
            restarted
                .store_credential(Some(SEARXNG_SEARCH_PROVIDER_ID), "do-not-forward".into())
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn custom_configuration_and_invalid_file_never_silently_fall_back_to_exa() {
        let (root, keys, service) = setup();
        service
            .update(UpdateWebSearchConfigRequest {
                provider_id: SEARXNG_SEARCH_PROVIDER_ID.into(),
                endpoint: Some("http://localhost:8080/".into()),
            })
            .unwrap();
        assert_eq!(
            service.status().providers[2].endpoint.as_deref(),
            Some("http://localhost:8080/search")
        );
        let custom = service.provider();
        assert!(custom.required_static_credential("search").is_none());
        service
            .update(UpdateWebSearchConfigRequest {
                provider_id: EXA_SEARCH_PROVIDER_ID.into(),
                endpoint: None,
            })
            .unwrap();
        assert_eq!(
            service.status().providers[2].endpoint.as_deref(),
            Some("http://localhost:8080/search")
        );
        fs::write(root.join("web-search.json"), b"{ broken").unwrap();
        let invalid = WebSearchService::new(keys, root.join("web-search.json")).unwrap();
        assert!(invalid.status().config_error.is_some());
        assert!(!invalid.status().available);
        assert!(
            invalid
                .provider()
                .discover_tools(2)
                .unwrap()
                .iter()
                .all(|t| t.provider_tool_name != "search")
        );
        assert_eq!(
            invalid.probe().error_code.as_deref(),
            Some("WEB_SEARCH_CONFIG_INVALID")
        );
        invalid
            .update(UpdateWebSearchConfigRequest {
                provider_id: EXA_SEARCH_PROVIDER_ID.into(),
                endpoint: None,
            })
            .unwrap();
        assert!(invalid.status().config_error.is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
