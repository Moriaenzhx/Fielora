//! Trusted configured search endpoint only. Public fetch policy is unchanged.
use super::*;

pub const SEARXNG_SEARCH_PROVIDER_ID: &str = "searxng.search.v1";

fn loopback_addresses(url: &Url) -> Option<Vec<SocketAddr>> {
    let port = url.port_or_known_default()?;
    let host = url.host_str()?;
    if host == "localhost" {
        return Some(vec![
            SocketAddr::from(([127, 0, 0, 1], port)),
            SocketAddr::new(std::net::Ipv6Addr::LOCALHOST.into(), port),
        ]);
    }
    let ip: IpAddr = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok()?;
    ip.is_loopback().then(|| vec![SocketAddr::new(ip, port)])
}

pub fn validate_search_endpoint(value: &str) -> Result<String, WebFailure> {
    if value.len() > MAX_URL_BYTES || value.trim() != value {
        return Err(WebFailure::InvalidInput);
    }
    let mut url = Url::parse(value).map_err(|_| WebFailure::InvalidInput)?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.scheme(), "http" | "https")
    {
        return Err(WebFailure::DestinationRejected);
    }
    if loopback_addresses(&url).is_none() {
        if url.scheme() != "https" {
            return Err(WebFailure::DestinationRejected);
        }
        parse_public_url(url.as_str())?;
    }
    if url.path() == "/" {
        url.set_path("/search");
    }
    Ok(url.to_string())
}

pub(super) struct SearxngSearchBackend {
    endpoint: Url,
    public: SafePublicHttpClient,
    local: ReqwestNetwork,
}

impl SearxngSearchBackend {
    pub fn new(endpoint: &str) -> Result<Self, WebFailure> {
        Ok(Self {
            endpoint: Url::parse(&validate_search_endpoint(endpoint)?)
                .map_err(|_| WebFailure::InvalidInput)?,
            public: SafePublicHttpClient::production()?,
            local: ReqwestNetwork::new()?,
        })
    }
}

impl SearchBackend for SearxngSearchBackend {
    fn provider_id(&self) -> &'static str {
        SEARXNG_SEARCH_PROVIDER_ID
    }

    fn search(
        &self,
        request: &WebSearchRequest,
        cancellation: &CommandCancellation,
    ) -> Result<SearchBackendResponse, WebFailure> {
        // No exact calendar range/country contract exists here. Do not silently
        // downgrade the model's requested filters to approximate time_range.
        if request.country.is_some()
            || request.published_after.is_some()
            || request.published_before.is_some()
        {
            return Err(WebFailure::InvalidInput);
        }
        ensure_not_cancelled(cancellation)?;
        let mut url = self.endpoint.clone();
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("q", &request.query)
                .append_pair("format", "json")
                .append_pair("categories", "general");
            if let Some(language) = &request.search_lang {
                query.append_pair("language", language);
            }
        }
        let headers = vec![
            (ACCEPT, HeaderValue::from_static("application/json")),
            (ACCEPT_ENCODING, HeaderValue::from_static("identity")),
        ];
        let response = if let Some(addresses) = loopback_addresses(&self.endpoint) {
            // No DNS, proxy, alternate destination or redirect. This exception
            // cannot be reached by a model-supplied URL or by web.fetch.
            let started = Instant::now();
            let mut response = Err(WebFailure::Network);
            for address in addresses {
                let remaining = SEARCH_TIMEOUT
                    .checked_sub(started.elapsed())
                    .ok_or(WebFailure::Timeout)?;
                response = self
                    .local
                    .send(&url, &[address], &headers, remaining, cancellation);
                if !matches!(response, Err(WebFailure::Network | WebFailure::Timeout)) {
                    break;
                }
            }
            let hop = response?;
            if is_redirect(hop.status) {
                return Err(WebFailure::RedirectRejected);
            }
            if hop
                .content_encoding
                .as_ref()
                .is_some_and(|s| !s.is_empty() && !s.eq_ignore_ascii_case("identity"))
            {
                return Err(WebFailure::UnsupportedContent);
            }
            RawHttpResponse {
                final_url: url,
                status: hop.status,
                content_type: hop.content_type,
                body: hop.body,
            }
        } else {
            // credentialed=true enforces no redirect, even though this adapter
            // never receives or forwards a credential.
            self.public
                .get(url, headers, true, SEARCH_TIMEOUT, cancellation)?
        };
        classify_http_status(response.status, false)?;
        if !response
            .content_type
            .as_deref()
            .unwrap_or_default()
            .split(';')
            .next()
            .is_some_and(|s| s.trim().eq_ignore_ascii_case("application/json"))
        {
            return Err(WebFailure::MalformedResponse);
        }
        let result: SearxngResponse =
            serde_json::from_slice(&response.body).map_err(|_| WebFailure::MalformedResponse)?;
        let results = result
            .results
            .into_iter()
            .filter(|r| {
                request.domains.is_empty()
                    || Url::parse(&r.url)
                        .ok()
                        .and_then(|u| u.host_str().map(str::to_owned))
                        .is_some_and(|host| {
                            request.domains.iter().any(|domain| {
                                host == *domain || host.ends_with(&format!(".{domain}"))
                            })
                        })
            })
            .take(request.count)
            .map(|r| SearchBackendResult {
                title: r.title,
                url: r.url,
                snippet: r.content,
                published_at: r.published_date,
            })
            .collect();
        Ok(SearchBackendResponse { results })
    }
}

#[derive(Deserialize)]
struct SearxngResponse {
    results: Vec<SearxngResult>,
}
#[derive(Deserialize)]
struct SearxngResult {
    title: String,
    url: String,
    #[serde(default)]
    content: String,
    #[serde(default, rename = "publishedDate")]
    published_date: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    fn serve(
        status: &str,
        content_type: &str,
        extra: &str,
        body: &str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/search", listener.local_addr().unwrap());
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
            body.len()
        );
        let thread = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let started = Instant::now();
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && started.elapsed() < Duration::from_secs(12) =>
                    {
                        std::thread::sleep(Duration::from_millis(10))
                    }
                    Err(error) => panic!("fixture server: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = vec![0; 8192];
            let n = stream.read(&mut request).unwrap();
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8(request[..n].to_vec()).unwrap()
        });
        (endpoint, thread)
    }
    #[test]
    fn custom_search_is_real_loopback_http_with_bounded_normalized_public_results() {
        let body = json!({"results":[{"title":"Other","url":"https://other.example/","content":"omit"},{"title":"Rust","url":"https://doc.rust-lang.org/book/","content":"Public source <script>untrusted</script>","publishedDate":"2026-10-12"}]}).to_string();
        let (endpoint, server) = serve("200 OK", "application/json", "", &body);
        let provider = WebToolProvider::with_searxng(&endpoint).unwrap();
        let result = provider
            .execute(
                "search",
                &json!({"query":"Rust & 中文", "count":1,"domains":["rust-lang.org"]}),
                &CommandCancellation::default(),
            )
            .unwrap();
        assert_eq!(result.receipt["provider_id"], SEARXNG_SEARCH_PROVIDER_ID);
        assert_eq!(result.receipt["result_count"], 1);
        assert_eq!(
            result.receipt["sources"][0]["url"],
            "https://doc.rust-lang.org/book/"
        );
        assert!(result.observation.contains("UNTRUSTED_WEB_CONTENT"));
        let request = server.join().unwrap();
        assert!(request.contains("format=json"));
        assert!(request.contains("Rust+%26+"));
        assert!(!request.to_lowercase().contains("authorization:"));
        assert!(
            PublicWebFetcher::new(Arc::new(SafePublicHttpClient::production().unwrap()))
                .fetch(&endpoint, &CommandCancellation::default())
                .is_err()
        );
    }
    #[test]
    fn custom_endpoint_rejects_nonlocal_http_credentials_internal_ips_and_extra_scope() {
        for endpoint in [
            "http://example.com/search",
            "https://key@example.com/search",
            "https://example.com/search?key=secret",
            "https://example.com/#secret",
            "https://10.0.0.1/search",
            "http://169.254.169.254/search",
            "file:///tmp/search",
        ] {
            assert!(validate_search_endpoint(endpoint).is_err(), "{endpoint}");
        }
        for endpoint in [
            "http://localhost:8888/search",
            "http://127.0.0.1:8888/search",
            "http://[::1]:8888/search",
            "https://search.example/search",
        ] {
            assert!(validate_search_endpoint(endpoint).is_ok(), "{endpoint}");
        }
        let provider = WebToolProvider::with_searxng("http://localhost:1/search").unwrap();
        assert!(
            provider
                .execute_with_static_credential(
                    "search",
                    &json!({"query":"q"}),
                    Some(SecretBytes::new(b"never-forward".to_vec())),
                    &CommandCancellation::default()
                )
                .is_err()
        );
        assert!(
            provider
                .execute(
                    "search",
                    &json!({"query":"q","published_after":"2026-01-01"}),
                    &CommandCancellation::default()
                )
                .is_err()
        );
        let schema = provider
            .discover_tools(2)
            .unwrap()
            .remove(0)
            .definition
            .input_schema;
        assert!(schema["properties"].get("published_after").is_none());
    }
    #[test]
    fn self_hosted_search_never_follows_redirect_or_accepts_html_as_empty_success() {
        for (status, mime, extra, body, expected) in [
            (
                "302 Found",
                "application/json",
                "Location: http://169.254.169.254/\r\n",
                "{}",
                WebFailure::RedirectRejected,
            ),
            (
                "200 OK",
                "text/html",
                "",
                "<html>login</html>",
                WebFailure::MalformedResponse,
            ),
            (
                "200 OK",
                "application/json",
                "",
                "{}",
                WebFailure::MalformedResponse,
            ),
            (
                "403 Forbidden",
                "text/plain",
                "",
                "JSON output disabled",
                WebFailure::HttpClient,
            ),
        ] {
            let (endpoint, server) = serve(status, mime, extra, body);
            let backend = SearxngSearchBackend::new(&endpoint).unwrap();
            let request = WebSearchRequest {
                query: "q".into(),
                count: 2,
                country: None,
                search_lang: None,
                domains: vec![],
                published_after: None,
                published_before: None,
            };
            assert_eq!(
                backend.search(&request, &CommandCancellation::default()),
                Err(expected)
            );
            server.join().unwrap();
        }
    }
}
