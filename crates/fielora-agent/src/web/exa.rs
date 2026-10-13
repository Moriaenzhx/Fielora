//! Fixed, read-only Exa hosted search adapter. This deliberately does not expose
//! remote MCP discovery, arbitrary methods, sessions or Exa's research Agent.
use super::*;

pub const EXA_SEARCH_PROVIDER_ID: &str = "exa.search.v1";
const ENDPOINT: &str = "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa";
const EXA_TIMEOUT: Duration = Duration::from_secs(20);

pub struct ExaSearchBackend {
    http: Arc<dyn WebHttpClient>,
    credentialed: bool,
}

impl ExaSearchBackend {
    pub(super) fn new(http: Arc<dyn WebHttpClient>, credentialed: bool) -> Self {
        Self { http, credentialed }
    }
}

impl SearchBackend for ExaSearchBackend {
    fn provider_id(&self) -> &'static str {
        EXA_SEARCH_PROVIDER_ID
    }

    fn required_static_credential(&self) -> Option<StaticCredentialRequirement> {
        self.credentialed.then(|| {
            StaticCredentialRequirement::new(EXA_SEARCH_PROVIDER_ID, "api_key")
                .expect("fixed Exa requirement")
        })
    }

    fn search(
        &self,
        request: &WebSearchRequest,
        cancellation: &CommandCancellation,
    ) -> Result<SearchBackendResponse, WebFailure> {
        self.search_with_static_credential(request, None, cancellation)
    }

    fn search_with_static_credential(
        &self,
        request: &WebSearchRequest,
        credential: Option<SecretBytes>,
        cancellation: &CommandCancellation,
    ) -> Result<SearchBackendResponse, WebFailure> {
        ensure_not_cancelled(cancellation)?;
        let mut headers = vec![(
            ACCEPT,
            HeaderValue::from_static("application/json, text/event-stream"),
        )];
        match (self.credentialed, credential) {
            (true, Some(secret)) => {
                if secret.expose().is_empty()
                    || secret.expose().len() > fielora_platform::MAX_CREDENTIAL_BYTES
                {
                    return Err(WebFailure::InvalidInput);
                }
                let mut value = HeaderValue::from_bytes(secret.expose())
                    .map_err(|_| WebFailure::InvalidInput)?;
                value.set_sensitive(true);
                headers.push((HeaderName::from_static("x-api-key"), value));
            }
            (true, None) => return Err(WebFailure::CredentialMissing),
            (false, Some(_)) => return Err(WebFailure::InvalidInput),
            (false, None) => {}
        }
        let mut args = json!({"query":request.query,"numResults":request.count,"type":"auto","textMaxCharacters":1800,"enableHighlights":true,"highlightsMaxCharacters":1200});
        if !request.domains.is_empty() {
            args["includeDomains"] = json!(request.domains);
        }
        if let Some(date) = &request.published_after {
            args["startPublishedDate"] = json!(date);
        }
        if let Some(date) = &request.published_before {
            args["endPublishedDate"] = json!(date);
        }
        if let Some(country) = &request.country {
            args["userLocation"] = json!(country);
        }
        // Exa has no equivalent language filter. Refuse instead of silently
        // implying that a requested restriction was enforced.
        if request.search_lang.is_some() {
            return Err(WebFailure::InvalidInput);
        }
        let body = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search_advanced_exa","arguments":args}})).map_err(|_| WebFailure::InvalidInput)?;
        let response = self.http.post_json(
            Url::parse(ENDPOINT).expect("fixed Exa URL"),
            headers,
            &body,
            EXA_TIMEOUT,
            cancellation,
        )?;
        ensure_not_cancelled(cancellation)?;
        classify_http_status(response.status, true)?;
        parse_response(&response, request.count)
    }
}

fn parse_response(
    response: &RawHttpResponse,
    count: usize,
) -> Result<SearchBackendResponse, WebFailure> {
    if response.body.len() > MAX_HTTP_BODY_BYTES {
        return Err(WebFailure::OversizedResponse);
    }
    let mime = response
        .content_type
        .as_deref()
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim();
    let envelope: Value = if mime.eq_ignore_ascii_case("application/json") {
        serde_json::from_slice(&response.body).map_err(|_| WebFailure::MalformedResponse)?
    } else if mime.eq_ignore_ascii_case("text/event-stream") {
        let text = std::str::from_utf8(&response.body)
            .map_err(|_| WebFailure::MalformedResponse)?
            .replace("\r\n", "\n");
        let mut found = None;
        for (index, event) in text.split("\n\n").enumerate() {
            if index >= 64 {
                return Err(WebFailure::OversizedResponse);
            }
            let data = event
                .lines()
                .filter_map(|line| {
                    line.strip_prefix("data:")
                        .map(|s| s.strip_prefix(' ').unwrap_or(s))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if data.is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&data).map_err(|_| WebFailure::MalformedResponse)?;
            if value["id"] == 1 {
                if found.is_some() {
                    return Err(WebFailure::MalformedResponse);
                }
                found = Some(value);
            }
        }
        found.ok_or(WebFailure::MalformedResponse)?
    } else {
        return Err(WebFailure::MalformedResponse);
    };
    if envelope["jsonrpc"] != "2.0" || envelope["id"] != 1 {
        return Err(WebFailure::MalformedResponse);
    }
    if envelope.get("error").is_some() {
        return Err(WebFailure::Unavailable);
    }
    let result = envelope
        .get("result")
        .ok_or(WebFailure::MalformedResponse)?;
    // Exa can return a rate-limit notice as an ordinary HTTP-200 text result.
    if result["_meta"]["ai.exa/rateLimited"] == true {
        return Err(WebFailure::RateLimited);
    }
    if result["isError"] == true {
        return Err(WebFailure::Unavailable);
    }
    let contents = result["content"]
        .as_array()
        .ok_or(WebFailure::MalformedResponse)?;
    if contents.len() != 1 || contents[0]["type"] != "text" {
        return Err(WebFailure::MalformedResponse);
    }
    let text = contents[0]["text"]
        .as_str()
        .ok_or(WebFailure::MalformedResponse)?;
    // The advanced tool serializes the typed search response as JSON. Unknown
    // prose/error formats must never be interpreted as zero search results.
    let response: ExaResponse =
        serde_json::from_str(text).map_err(|_| WebFailure::MalformedResponse)?;
    if response.results.len() > 100 {
        return Err(WebFailure::OversizedResponse);
    }
    Ok(SearchBackendResponse {
        results: response
            .results
            .into_iter()
            .take(count)
            .map(|source| SearchBackendResult {
                title: source.title,
                url: source.url,
                snippet: truncate_utf8(
                    &if source.highlights.is_empty() {
                        source.text.unwrap_or_default()
                    } else {
                        source.highlights.join("\n")
                    },
                    MAX_SNIPPET_BYTES,
                ),
                published_at: source.published_date,
            })
            .collect(),
    })
}

#[derive(Deserialize)]
struct ExaResponse {
    results: Vec<ExaResult>,
}

#[derive(Deserialize)]
struct ExaResult {
    title: String,
    url: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    highlights: Vec<String>,
    #[serde(rename = "publishedDate")]
    published_date: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wire(result: Value, sse: bool) -> RawHttpResponse {
        let value = json!({"jsonrpc":"2.0","id":1,"result":result});
        RawHttpResponse {
            final_url: Url::parse(ENDPOINT).unwrap(),
            status: 200,
            content_type: Some(
                if sse {
                    "text/event-stream"
                } else {
                    "application/json"
                }
                .into(),
            ),
            body: if sse {
                format!("event: message\r\ndata: {value}\r\n\r\n").into_bytes()
            } else {
                serde_json::to_vec(&value).unwrap()
            },
        }
    }
    fn result() -> Value {
        json!({"content":[{"type":"text","text":json!({"results":[{"title":"Rust","url":"https://doc.rust-lang.org/","highlights":["actual source excerpt"],"publishedDate":"2026-10-11T00:00:00Z"}]}).to_string()}]})
    }
    #[test]
    fn search_envelope_preserves_sources_and_rejects_false_empty_success() {
        for sse in [true, false] {
            let parsed = parse_response(&wire(result(), sse), 5).unwrap();
            assert_eq!(parsed.results[0].snippet, "actual source excerpt");
            assert_eq!(
                parsed.results[0].published_at.as_deref(),
                Some("2026-10-11T00:00:00Z")
            );
            assert_eq!(
                parse_response(
                    &wire(
                        json!({"_meta":{"ai.exa/rateLimited":true},"content":[{"type":"text","text":"private vendor notice"}]}),
                        sse
                    ),
                    5
                ),
                Err(WebFailure::RateLimited)
            );
            assert_eq!(
                parse_response(&wire(json!({"isError":true,"content":[]}), sse), 5),
                Err(WebFailure::Unavailable)
            );
            assert_eq!(
                parse_response(
                    &wire(
                        json!({"content":[{"type":"text","text":"unknown error"}]}),
                        sse
                    ),
                    5
                ),
                Err(WebFailure::MalformedResponse)
            );
            assert!(
                parse_response(
                    &wire(
                        json!({"content":[{"type":"text","text":"{\"results\":[]}"}]}),
                        sse
                    ),
                    5
                )
                .unwrap()
                .results
                .is_empty()
            );
        }
        let mut response = wire(result(), true);
        response.body.extend_from_within(..);
        assert_eq!(
            parse_response(&response, 5),
            Err(WebFailure::MalformedResponse)
        );
    }

    struct HttpFixture {
        calls: std::sync::atomic::AtomicUsize,
    }
    impl WebHttpClient for HttpFixture {
        fn get(
            &self,
            _: Url,
            _: Vec<(HeaderName, HeaderValue)>,
            _: bool,
            _: Duration,
            _: &CommandCancellation,
        ) -> Result<RawHttpResponse, WebFailure> {
            panic!("search must use its fixed POST")
        }
        fn post_json(
            &self,
            url: Url,
            headers: Vec<(HeaderName, HeaderValue)>,
            body: &[u8],
            _: Duration,
            cancellation: &CommandCancellation,
        ) -> Result<RawHttpResponse, WebFailure> {
            ensure_not_cancelled(cancellation)?;
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            assert_eq!(url.as_str(), ENDPOINT);
            let request: Value = serde_json::from_slice(body).unwrap();
            assert_eq!(request["method"], "tools/call");
            assert_eq!(request["params"]["name"], "web_search_advanced_exa");
            let args = &request["params"]["arguments"];
            assert_eq!(args["query"], "中文新闻 & official");
            assert_eq!(args["startPublishedDate"], "2026-10-01");
            assert_eq!(args["endPublishedDate"], "2026-10-12");
            assert_eq!(args["includeDomains"], json!(["example.com"]));
            if let Some((_, key)) = headers
                .iter()
                .find(|(name, _)| name.as_str() == "x-api-key")
            {
                assert!(key.is_sensitive());
                assert_eq!(key.as_bytes(), b"synthetic-exa-secret");
                assert!(!String::from_utf8_lossy(body).contains("synthetic-exa-secret"));
                assert!(!url.as_str().contains("synthetic-exa-secret"));
            }
            Ok(wire(result(), true))
        }
    }

    #[test]
    fn exa_wire_filters_and_exact_optional_credential_are_bounded() {
        let http = Arc::new(HttpFixture {
            calls: std::sync::atomic::AtomicUsize::new(0),
        });
        let keyed = WebToolProvider::new(
            Arc::new(ExaSearchBackend::new(http.clone(), true)),
            Arc::new(PublicWebFetcher::new(http.clone())),
        );
        let args = json!({"query":"中文新闻 & official","count":2,"domains":["example.com"],"published_after":"2026-10-01","published_before":"2026-10-12"});
        assert_eq!(
            keyed.execute("search", &args, &CommandCancellation::default()),
            Err(WebFailure::CredentialMissing.provider_error())
        );
        let output = keyed
            .execute_with_static_credential(
                "search",
                &args,
                Some(SecretBytes::new(b"synthetic-exa-secret".to_vec())),
                &CommandCancellation::default(),
            )
            .unwrap();
        assert_eq!(
            output.receipt["sources"][0]["url"],
            "https://doc.rust-lang.org/"
        );
        assert!(!output.observation.contains("synthetic-exa-secret"));
        // Public previews are now deliberately retained, but credential bytes
        // and unbounded source archives remain excluded from receipts.
        assert!(
            output.receipt["sources"][0]["snippet"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 480)
        );
        assert!(!output.receipt.to_string().contains("synthetic-exa-secret"));
        let keyless = WebToolProvider::new(
            Arc::new(ExaSearchBackend::new(http.clone(), false)),
            Arc::new(PublicWebFetcher::new(http.clone())),
        );
        assert!(
            keyless
                .execute("search", &args, &CommandCancellation::default())
                .is_ok()
        );
        for extra in [
            json!({"published_after":"2026-02-30"}),
            json!({"published_after":"2026-10-13"}),
            json!({"domains":["http://127.0.0.1"]}),
            json!({"search_lang":"zh"}),
        ] {
            let mut bad = args.clone();
            bad.as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert_eq!(
                keyless.execute("search", &bad, &CommandCancellation::default()),
                Err(WebFailure::InvalidInput.provider_error())
            );
        }
        let cancelled = CommandCancellation::default();
        cancelled.cancel();
        assert_eq!(
            keyless.execute("search", &args, &cancelled),
            Err(ToolProviderError::Cancelled)
        );
        assert_eq!(http.calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert!(
            keyless.discover_tools(2).unwrap()[0]
                .definition
                .input_schema["properties"]
                .get("search_lang")
                .is_none()
        );
    }

    #[test]
    #[ignore = "Explicit public Exa search/fetch smoke; external keyless quota may block it"]
    fn exa_live_search_then_read_source() {
        let provider = WebToolProvider::with_exa(false).unwrap();
        let search=provider.execute("search",&json!({"query":"Rust programming language official documentation","count":2,"domains":["rust-lang.org"]}),&CommandCancellation::default()).unwrap();
        let result: Value = serde_json::from_str(&search.observation).unwrap();
        assert_eq!(result["provider_id"], EXA_SEARCH_PROVIDER_ID);
        let url = result["results"][0]["url"]
            .as_str()
            .expect("real search URL");
        let read = provider
            .execute(
                "fetch",
                &json!({"url":url}),
                &CommandCancellation::default(),
            )
            .unwrap();
        assert!(read.receipt["text_returned_chars"].as_u64().unwrap() > 30);
        assert!(
            search.receipt["sources"][0]["snippet"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 480)
        );
        assert!(
            read.receipt["excerpt"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 640)
        );
        println!(
            "LIVE_SEARCH_FETCH provider={} results={} source={} chars={}",
            EXA_SEARCH_PROVIDER_ID,
            search.receipt["result_count"],
            url,
            read.receipt["text_returned_chars"]
        );
    }
}
