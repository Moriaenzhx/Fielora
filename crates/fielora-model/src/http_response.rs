//! Only numeric protocol facts cross the adapter boundary, never raw headers/body.
use reqwest::header::{HeaderMap, RETRY_AFTER};
use std::time::SystemTime;

pub(super) fn retry_after_seconds(headers: &HeaderMap, now: SystemTime) -> Option<u64> {
    let raw = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.bytes().all(|byte| byte.is_ascii_digit()) {
        // Overflow is a long delay, never a reason to retry immediately.
        return Some(raw.parse().unwrap_or(u64::MAX));
    }
    let remaining = httpdate::parse_http_date(raw)
        .ok()?
        .duration_since(now)
        .unwrap_or_default();
    Some(
        remaining
            .as_secs()
            .saturating_add(u64::from(remaining.subsec_nanos() > 0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ModelError, checked_response};
    use tokio_util::sync::CancellationToken;

    #[test]
    fn retry_advice_handles_seconds_dates_invalid_and_overflow() {
        let now = httpdate::parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT").unwrap();
        for (raw, expected) in [
            ("12", Some(12)),
            ("0", Some(0)),
            ("Sun, 06 Nov 1994 08:49:47 GMT", Some(10)),
            ("Sun, 06 Nov 1994 08:49:36 GMT", Some(0)),
            ("999999999999999999999999999", Some(u64::MAX)),
            ("-1", None),
            ("1.2", None),
            ("private-secret", None),
            ("", None),
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(RETRY_AFTER, raw.parse().unwrap());
            assert_eq!(retry_after_seconds(&headers, now), expected, "{raw}");
        }
        assert_eq!(retry_after_seconds(&HeaderMap::new(), now), None);
    }

    #[tokio::test]
    async fn wire_failures_retain_only_status_and_parsed_advice() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (status, code) in [
            (408, "PROVIDER_REQUEST_TIMEOUT"),
            (429, "PROVIDER_RATE_LIMITED"),
            (503, "PROVIDER_UNAVAILABLE"),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024];
                let _ = stream.read(&mut request).await.unwrap();
                stream.write_all(format!("HTTP/1.1 {status} Rejected\r\nRetry-After: 90\r\nX-Request-Id: private-header\r\nContent-Length: 12\r\nConnection: close\r\n\r\nprivate-body").as_bytes()).await.unwrap();
            });
            // Local fixture uses reqwest directly; production endpoint policy is unchanged.
            let response = reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(format!("http://{address}"))
                .send()
                .await
                .unwrap();
            let error = checked_response(response, &CancellationToken::new())
                .await
                .unwrap_err();
            assert_eq!(error.code(), code);
            assert_eq!(error.http_status(), Some(status));
            assert_eq!(
                error.response_diagnostics().unwrap().retry_after_seconds,
                Some(90)
            );
            assert!(matches!(error, ModelError::Response { .. }));
            let retained = serde_json::to_string(error.response_diagnostics().unwrap()).unwrap();
            for marker in [
                "private-body",
                "private-header",
                "X-Request-Id",
                "Retry-After",
            ] {
                assert!(!retained.contains(marker));
                assert!(!format!("{error:?}").contains(marker));
            }
            server.await.unwrap();
        }
    }
}
